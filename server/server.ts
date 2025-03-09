
import WebSocket from 'ws';
import express from 'express';
import { createServer } from 'http';
import { ClientMessage, RegisterMessage, ServerMessage, TunnelRequest, TunnelResponse } from '../shared/types';
import { generateId, generateSubdomain } from '../shared/utils';
import http from "http"

export class TunnelServer {
  private app: express.Application;
  private server: http.Server;
  private wss: WebSocket.Server;
  private clients: Map<string, WebSocket> = new Map();
  private domainName: string;
  private activeTunnels: number = 0;
  
  constructor(options: { port: number, domainName: string }) {
    this.domainName = options.domainName;
    
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
        uptime: process.uptime()
      });
    });
    
    // Home route
    this.app.get('/', (req, res) => {
      res.send(`
        <html>
          <head>
            <title>NTNL Tunnel</title>
            <style>
              body {
                font-family: Arial, sans-serif;
                max-width: 800px;
                margin: 0 auto;
                padding: 20px;
                line-height: 1.6;
              }
              h1 {
                color: #333;
                border-bottom: 1px solid #eee;
                padding-bottom: 10px;
              }
              .stats {
                background: #f5f5f5;
                padding: 15px;
                border-radius: 5px;
                margin: 20px 0;
              }
            </style>
          </head>
          <body>
            <h1>NTNL - no tunnnel no life</h1>
            <p>This service allows you to expose local servers to the internet.</p>
            <div class="stats">
              <p>Currently active tunnels: ${this.activeTunnels}</p>
              <p>Server uptime: ${Math.floor(process.uptime() / 60)} minutes</p>
            </div>
          </body>
        </html>
      `);
    });
    
    // Health check route
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        activeTunnels: this.activeTunnels
      });
    });
    
    // Catch-all route for tunnel requests
    this.app.use('*', this.tunnelRequestHandler.bind(this));
  }
  
  private setupWebSocketHandlers() {
    this.wss.on('connection', (ws: WebSocket) => {
      console.log('New client connected');
      
      ws.on('message', (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString()) as ClientMessage;
          
          if (message.type === 'register') {
            this.registerClient(ws, message as RegisterMessage);
          } else if (message.type === 'tunnel') {
            this.handleTunnelResponse(message.data as TunnelResponse);
          }
        } catch (error) {
          console.error('Error processing message:', error);
          this.sendError(ws, 'Invalid message format');
        }
      });
      
      ws.on('close', () => {
        // Remove client on disconnect
        for (const [subdomain, client] of this.clients.entries()) {
          if (client === ws) {
            this.clients.delete(subdomain);
            this.activeTunnels--;
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
    
    const client = this.clients.get(subdomain);
    
    if (!client) {
      res.status(404).send('Tunnel not found');
      return;
    }
    
    // Create tunnel request
    const tunnelRequest: TunnelRequest = {
      id: generateId(),
      method: req.method,
      path: req.originalUrl || req.url,
      headers: req.headers as Record<string, string>,
      body: (req as any).rawBody
    };
    
    // Create a promise that will be resolved when the response is received
    const responsePromise = new Promise<TunnelResponse>((resolve) => {
      const pendingRequests = this.getPendingRequests(client);
      pendingRequests.set(tunnelRequest.id, resolve);
      
      // Set a timeout to avoid hanging requests
      setTimeout(() => {
        if (pendingRequests.has(tunnelRequest.id)) {
          pendingRequests.delete(tunnelRequest.id);
          resolve({
            id: tunnelRequest.id,
            statusCode: 504,
            headers: { 'content-type': 'text/plain' },
            body: Buffer.from('Gateway Timeout')
          });
        }
      }, 30000); // 30 seconds timeout
    });
    
    // Send the request to the client
    try {
      const message: ServerMessage = {
        type: 'tunnel',
        data: tunnelRequest
      };
      
      client.send(JSON.stringify(message));
      
      // Wait for the response
      responsePromise.then((response) => {
        // Send the response back to the original client
        for (const [key, value] of Object.entries(response.headers)) {
          res.setHeader(key, value);
        }
        
        res.status(response.statusCode);
        
        if (response.body) {
          res.send(response.body);
        } else {
          res.end();
        }
      }).catch((error) => {
        console.error('Error handling tunnel response:', error);
        res.status(500).send('Internal Server Error');
      });
    } catch (error) {
      console.error('Error sending tunnel request:', error);
      res.status(500).send('Internal Server Error');
    }
  }
  
  private registerClient(ws: WebSocket, message: RegisterMessage): void {
    let subdomain = message.subdomain;
    
    if (!subdomain) {
      subdomain = generateSubdomain();
    }
    
    // Check if subdomain is already in use
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
    
    const registeredMessage: ServerMessage = {
      type: 'registered',
      url: `http://${subdomain}.${this.domainName}`
    };
    
    ws.send(JSON.stringify(registeredMessage));
    console.log(`Client registered with subdomain: ${subdomain}`);
  }
  
  private handleTunnelResponse(response: TunnelResponse): void {
    for (const [, client] of this.clients.entries()) {
      const pendingRequests = this.getPendingRequests(client);
      const resolve = pendingRequests.get(response.id);
      
      if (resolve) {
        pendingRequests.delete(response.id);
        resolve(response);
        break;
      }
    }
  }
  
  private getPendingRequests(client: WebSocket): Map<string, (response: TunnelResponse) => void> {
    // @ts-ignore - Using a custom property to store pending requests
    if (!client.pendingRequests) {
      // @ts-ignore
      client.pendingRequests = new Map();
    }
    
    // @ts-ignore
    return client.pendingRequests;
  }
  
  public getStats() {
    return {
      activeTunnels: this.activeTunnels,
      uptime: process.uptime()
    };
  }
  
  public close(): void {
    this.server.close();
    this.wss.close();
  }
}