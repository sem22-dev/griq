import WebSocket from 'ws';
import express from 'express';
import { createServer } from 'http';
import { ClientMessage, RegisterMessage, ServerMessage, TunnelRequest, TunnelResponse } from '../shared/types';
import { generateId, generateSubdomain } from '../shared/utils';
import { RateLimiter, TunnelRateLimiter } from '../middleware/rateLimiter';
import http from "http";
import path from 'path';
import fs from "fs"

export class TunnelServer {
  private app: express.Application;
  private server: http.Server;
  private wss: WebSocket.Server;
  private clients: Map<string, WebSocket> = new Map();
  private domainName: string;
  private activeTunnels: number = 0;
  
  // Rate limiting
  private ipRateLimiter: RateLimiter;
  private tunnelRateLimiter: TunnelRateLimiter;
  
  constructor(options: { port: number, domainName: string }) {
    this.domainName = options.domainName;
    
    // Initialize rate limiters
    this.ipRateLimiter = new RateLimiter(60 * 1000, 60); // 60 requests per minute
    this.tunnelRateLimiter = new TunnelRateLimiter();
    
    // Create Express app
    this.app = express();
    
    // Configure Express middleware
    this.app.use(express.json({
      limit: '10mb',
      verify: (req, res, buf) => {
        // Store raw body for later use
        (req as any).rawBody = buf;
      }
    }));
    
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));
    
    // Add rate limiting middleware
    this.app.use(this.ipRateLimiter.middleware());
    
    // Add routes
    this.setupRoutes();
    
    // Create HTTP server
    this.server = createServer(this.app);
    
    // Create WebSocket server
    this.wss = new WebSocket.Server({ server: this.server });
    
    this.setupWebSocketHandlers();
    
    // Start server
    this.server.listen(options.port, () => {
      console.log(`Tunnel server listening on port ${options.port}`);
    });
  }
  
  private setupRoutes() {
    // API Routes
    this.app.get('/api/stats', (req, res) => {
      res.json({
        activeTunnels: this.activeTunnels,
        uptime: process.uptime(),
        rateLimitStats: {
          ip: this.ipRateLimiter.getStats(),
          tunnel: this.tunnelRateLimiter.getStats()
        }
      });
    });
    
    // Rate limit status endpoint
    this.app.get('/api/rate-limit-status', (req, res) => {
      const clientIp = this.extractClientIp(req);
      const result = this.ipRateLimiter.checkLimit(clientIp);
      
      res.json({
        ip: clientIp,
        limits: {
          remaining: result.remaining,
          resetTime: result.resetTime,
          retryAfter: result.retryAfter
        }
      });
    });
  
    // Root route for landing page
    this.app.get('/', (req, res) => {
      const host = req.headers['x-forwarded-host'] || req.headers.host || '';
      console.log('Host header:', host); // Debug log
      console.log('Domain name:', this.domainName); // Debug log
  
      if (host === this.domainName.replace(/^https?:\/\//, '') || host === `www.${this.domainName.replace(/^https?:\/\//, '')}`) {
        const htmlPath = path.join(__dirname, 'static', 'landingpage.html');
        console.log('Serving landing page from:', htmlPath); // Debug log
        fs.readFile(htmlPath, 'utf8', (err, data) => {
          if (err) {
            console.error('Error reading landing page:', err);
            res.status(500).send('Error loading page');
            return;
          }
          const htmlWithValues = data
            .replace('id="activeTunnels">--<', `id="activeTunnels">${this.activeTunnels}<`)
            .replace('id="serverUptime">--<', `id="serverUptime">${Math.floor(process.uptime() / 60)}<`);
          res.send(htmlWithValues);
        });
      } else {
        console.log('Routing to tunnel handler for:', host);
        this.tunnelRequestHandler(req, res);
      }
    });
  
    // Install script route
    this.app.get('/install.sh', (req, res) => {
      const filePath = path.join(__dirname, 'static', 'install.sh');
      res.setHeader('Content-Type', 'text/plain');
      res.sendFile(filePath);
    });
  
    // Static files for dist/bin
    this.app.use('/dist/bin', express.static(path.join(__dirname, '../dist/bin')));
  
    // Health check route
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        activeTunnels: this.activeTunnels
      });
    });
  
    // Catch-all route for tunnel requests (must be last)
    this.app.use('*', this.tunnelRequestHandler.bind(this));
  }
  
  private setupWebSocketHandlers() {
    this.wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
      const clientIp = this.extractClientIp(req as any);
      console.log('New client connected from IP:', clientIp);
      
      ws.on('message', (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString()) as ClientMessage;
          
          if (message.type === 'register') {
            this.registerClient(ws, message as RegisterMessage, clientIp);
          } else if (message.type === 'tunnel') {
            this.handleTunnelResponse(message.data as TunnelResponse);
          }
        } catch (error) {
          console.error('Error processing message:', error);
          this.sendError(ws, 'Invalid message format');
        }
      });
      
      ws.on('close', () => {
        for (const [subdomain, client] of this.clients.entries()) {
          if (client === ws) {
            this.clients.delete(subdomain);
            this.activeTunnels--;
            // Clean up rate limiting
            this.tunnelRateLimiter.removeTunnelConnection(clientIp, subdomain);
            console.log(`Client with subdomain ${subdomain} disconnected`);
            break;
          }
        }
      });
      
      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
      });

      // Set a ping interval to keep connection alive
      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        } else {
          clearInterval(pingInterval);
        }
      }, 30000);

      ws.on('close', () => {
        clearInterval(pingInterval);
      });
    });
  }
  
  private sendError(ws: WebSocket, message: string) {
    const errorMessage: ServerMessage = {
      type: 'error',
      message
    };
    
    ws.send(JSON.stringify(errorMessage));
  }
  
  private tunnelRequestHandler(req: express.Request, res: express.Response): void {
    const host = req.headers.host || '';
    const subdomain = host.split('.')[0];
    
    console.log(`Handling request for host: ${host}, subdomain: ${subdomain}`);
    
    const client = this.clients.get(subdomain);
    
    if (!client) {
      console.log(`No client found for subdomain: ${subdomain}`);
      res.status(404).send('Tunnel not found');
      return;
    }
    
    // Check client-specific rate limit
    if (!this.tunnelRateLimiter.checkClientRequest(subdomain)) {
      console.log(`Rate limit exceeded for tunnel: ${subdomain}`);
      res.status(429).json({
        error: 'Tunnel rate limit exceeded',
        message: `Too many requests to ${subdomain}. Try again later.`,
        subdomain
      });
      return;
    }
    
    let body: Buffer | undefined;
    if ((req as any).rawBody) {
      body = (req as any).rawBody;
    }
    
    const tunnelRequest: TunnelRequest = {
      id: generateId(),
      method: req.method,
      path: req.originalUrl || req.url,
      headers: this.cleanupHeaders(req.headers),
      body
    };
    
    const responsePromise = new Promise<TunnelResponse>((resolve) => {
      const pendingRequest = {
        resolve,
        timer: setTimeout(() => {
          console.log(`Request ${tunnelRequest.id} timed out after 120s`);
          this.getPendingRequests(client).delete(tunnelRequest.id);
          client.off('message', handleMessage);
          client.off('close', handleClose);
          resolve({
            id: tunnelRequest.id,
            statusCode: 504,
            headers: { 'content-type': 'text/plain' },
            body: Buffer.from('Gateway Timeout')
          });
        }, 120000)
      };
      
      this.getPendingRequests(client).set(tunnelRequest.id, pendingRequest);
  
      const handleMessage = (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString()) as ClientMessage;
          if (message.type === 'tunnel' && message.data.id === tunnelRequest.id) {
            const response = message.data as TunnelResponse;
            clearTimeout(pendingRequest.timer);
            this.getPendingRequests(client).delete(tunnelRequest.id);
            client.off('message', handleMessage);
            client.off('close', handleClose);
            resolve(response);
          }
        } catch (error) {
          console.error(`Error processing message for request ${tunnelRequest.id}:`, error);
        }
      };
  
      const handleClose = () => {
        clearTimeout(pendingRequest.timer);
        this.getPendingRequests(client).delete(tunnelRequest.id);
        client.off('message', handleMessage);
        client.off('close', handleClose);
        resolve({
          id: tunnelRequest.id,
          statusCode: 502,
          headers: { 'content-type': 'text/plain' },
          body: Buffer.from('Bad Gateway')
        });
      };
  
      client.on('message', handleMessage);
      client.on('close', handleClose);
    });
    
    try {
      console.log(`Sending tunnel request ${tunnelRequest.id} to client`);
      const message: ServerMessage = {
        type: 'tunnel',
        data: tunnelRequest
      };
      
      client.send(JSON.stringify(message));
      
      responsePromise.then((response) => {
        console.log(`Received response for request ${response.id}, status: ${response.statusCode}`);
        console.log('Response headers:', response.headers);
        console.log('Response body (raw):', response.body);
        console.log('Response body (string):', response.body?.toString('utf8') || 'No body');
        
        for (const [key, value] of Object.entries(response.headers)) {
          if (!['transfer-encoding', 'content-encoding'].includes(key.toLowerCase())) {
            res.setHeader(key, value);
          }
        }
        
        res.status(response.statusCode);
        
        if (response.body) {
          if (typeof response.body === 'object' && response.body !== null && 
              'type' in response.body && response.body.type === 'Buffer' && 
              'data' in response.body && Array.isArray(response.body.data)) {
            const bufferData = Buffer.from(response.body.data);
            res.send(bufferData);
          } else if (Buffer.isBuffer(response.body)) {
            res.send(response.body);
          } else {
            res.send(response.body);
          }
        } else {
          res.end();
        }
      }).catch((error) => {
        console.error(`Error handling tunnel response for request ${tunnelRequest.id}:`, error);
        res.status(502).send('Bad Gateway - Tunnel Error');
      });
    } catch (error) {
      console.error(`Error sending tunnel request ${tunnelRequest.id}:`, error);
      res.status(502).send('Bad Gateway - Tunnel Error');
    }
  }

  // Helper method to clean up headers
  private cleanupHeaders(headers: http.IncomingHttpHeaders): Record<string, string> {
    const cleanHeaders: Record<string, string> = {};
    
    for (const [key, value] of Object.entries(headers)) {
      if (value !== undefined) {
        // Skip internal headers that shouldn't be forwarded
        if (!['host', 'connection', 'sec-websocket-key', 'sec-websocket-version', 'sec-websocket-extensions', 'sec-websocket-protocol', 'upgrade'].includes(key.toLowerCase())) {
          cleanHeaders[key] = Array.isArray(value) ? value.join(', ') : String(value);
        }
      }
    }
    
    return cleanHeaders;
  }

  // Helper method to extract client IP
  private extractClientIp(req: any): string {
    const forwarded = req.headers['x-forwarded-for'];
    const realIp = req.headers['x-real-ip'];
    const cfConnectingIp = req.headers['cf-connecting-ip'];
    
    let ip = (cfConnectingIp || realIp || forwarded || req.socket.remoteAddress) as string;
    
    if (ip && ip.includes(',')) {
      ip = ip.split(',')[0].trim();
    }
    
    return ip || 'unknown';
  }

  // Update the handleTunnelResponse method
  private handleTunnelResponse(response: TunnelResponse): void {
    for (const [, client] of this.clients.entries()) {
      const pendingRequests = this.getPendingRequests(client);
      const pendingRequest = pendingRequests.get(response.id);
      
      if (pendingRequest) {
        // Clear the timeout to prevent it from firing
        clearTimeout(pendingRequest.timer);
        
        // Resolve the promise with the response
        pendingRequest.resolve(response);
        
        // Remove the request from pending
        pendingRequests.delete(response.id);
        
        break;
      }
    }
  }

  // Update the getPendingRequests method
  private getPendingRequests(client: WebSocket): Map<string, any> {
    // @ts-ignore - Using a custom property to store pending requests
    if (!client.pendingRequests) {
      // @ts-ignore
      client.pendingRequests = new Map();
    }
    
    // @ts-ignore
    return client.pendingRequests;
  }

  private registerClient(ws: WebSocket, message: RegisterMessage, clientIp: string): void {
    // Check subdomain creation rate limit
    if (!this.tunnelRateLimiter.checkSubdomainCreation(clientIp)) {
      const errorMessage: ServerMessage = {
        type: 'error',
        message: 'Subdomain creation rate limit exceeded. Try again later.'
      };
      ws.send(JSON.stringify(errorMessage));
      return;
    }
    
    // Check concurrent tunnel limit
    if (!this.tunnelRateLimiter.checkConcurrentTunnels(clientIp)) {
      const errorMessage: ServerMessage = {
        type: 'error',
        message: 'Maximum concurrent tunnels exceeded for your IP address.'
      };
      ws.send(JSON.stringify(errorMessage));
      return;
    }
    
    let subdomain = message.subdomain;
    
    if (!subdomain) {
      subdomain = generateSubdomain();
    }
    
    if (this.clients.has(subdomain)) {
      const errorMessage: ServerMessage = {
        type: 'error',
        message: 'Subdomain already in use'
      };
      ws.send(JSON.stringify(errorMessage));
      return;
    }
    
    this.clients.set(subdomain, ws);
    this.activeTunnels++;
    
    // Track for rate limiting
    this.tunnelRateLimiter.addTunnelConnection(clientIp, subdomain);
    
    const registeredMessage: ServerMessage = {
      type: 'registered',
      url: `https://${subdomain}.${this.domainName.replace(/^https?:\/\//, '')}`
    };
    
    ws.send(JSON.stringify(registeredMessage));
    console.log(`Client registered with subdomain: ${subdomain} from IP: ${clientIp}`);
  }

  public getStats() {
    return {
      activeTunnels: this.activeTunnels,
      uptime: process.uptime(),
      rateLimitStats: {
        ip: this.ipRateLimiter.getStats(),
        tunnel: this.tunnelRateLimiter.getStats()
      }
    };
  }
  
  public close(): void {
    // Clean up rate limiters
    this.ipRateLimiter.destroy();
    this.tunnelRateLimiter.destroy();
    
    this.server.close();
    this.wss.close();
  }
}