import WebSocket from 'ws';
import express from 'express';
import { createServer } from 'http';
import { ClientMessage, RegisterMessage, ServerMessage, TunnelRequest, TunnelResponse } from '../shared/types';
import { generateId, generateSubdomain } from '../shared/utils';
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
    
// Home route (root domain only)
this.app.get('/', (req, res) => {
  const host = req.headers.host || '';
  if (host === this.domainName.replace(/^https?:\/\//, '') || host === `www.${this.domainName.replace(/^https?:\/\//, '')}`) {
    // Read the HTML file and send it as response
    const htmlPath = path.join(__dirname, 'static', 'landingpage.html');
    fs.readFile(htmlPath, 'utf8', (err, data) => {
      if (err) {
        res.status(500).send('Error loading page');
        return;
      }
      
      // Replace any dynamic values if needed
      const htmlWithValues = data
        .replace('id="activeTunnels">--<', `id="activeTunnels">${this.activeTunnels}<`)
        .replace('id="serverUptime">--<', `id="serverUptime">${Math.floor(process.uptime() / 60)}<`);
      
      res.send(htmlWithValues);
    });
  } else {
    this.tunnelRequestHandler(req, res); // Handle subdomain requests
  }
});

// Add a route for the installation script
this.app.get('/install.sh', (req, res) => {
  res.setHeader('Content-Type', 'text/plain');
  res.send(`#!/bin/bash
set -e
# Define variables
URL_PREFIX="https://github.com/sem22-dev/griq/releases/download/v1.0.0"
INSTALL_DIR="/usr/local/bin"
DEFAULT_SERVER="wss://griq.site/"

# Determine system architecture
case "$(uname -sm)" in
  "Darwin x86_64") FILENAME="griq-darwin-amd64" ;;
  "Darwin arm64") FILENAME="griq-darwin-arm64" ;;
  "Linux x86_64") FILENAME="griq-linux-amd64" ;;
  "Linux i686") FILENAME="griq-linux-386" ;;
  "Linux armv7l") FILENAME="griq-linux-arm" ;;
  "Linux aarch64") FILENAME="griq-linux-arm64" ;;
  *) echo "Unsupported architecture: $(uname -sm)" >&2; exit 1 ;;
esac

echo "🚀 Installing Griq Tunneling Service"
echo "📦 Downloading $FILENAME..."

# Create config directory if it doesn't exist
CONFIG_DIR="$HOME/.griq"
mkdir -p "$CONFIG_DIR"

# Create config file with default server URL
echo "{\\\"server_url\\\":\\\"$DEFAULT_SERVER\\\"}" > "$CONFIG_DIR/config.json"
echo "✅ Created default configuration in $CONFIG_DIR"

# Download the binary
if ! curl -sSLf "$URL_PREFIX/$FILENAME" -o "$INSTALL_DIR/griq"; then
  echo "❌ Failed to write to $INSTALL_DIR; trying with sudo..." >&2
  if ! sudo curl -sSLf "$URL_PREFIX/$FILENAME" -o "$INSTALL_DIR/griq"; then
    echo "❌ Installation failed. Please try again with sudo privileges." >&2
    exit 1
  fi
fi

# Make binary executable
if ! chmod +x "$INSTALL_DIR/griq"; then
  echo "❌ Failed to set executable permission on $INSTALL_DIR/griq" >&2
  if ! sudo chmod +x "$INSTALL_DIR/griq"; then
    echo "❌ Installation failed. Please try again with sudo privileges." >&2
    exit 1
  fi
fi

echo "✅ Griq is successfully installed!"
echo ""
echo "🔰 Quick start:"
echo "   griq http 3000       # Expose port 3000"
echo ""
echo "📚 For more information, visit: https://github.com/sem22-dev/griq"
`);
});

// Example if dist/bin is at the same level as your server directory
this.app.use('/dist/bin', express.static(path.join(__dirname, '../dist/bin')));
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
  
  // In the TunnelServer class, update/replace these methods:

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
          client.off('message', handleMessage); // Remove message listener
          client.off('close', handleClose); // Remove close listener
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
            client.off('message', handleMessage); // Remove message listener
            client.off('close', handleClose); // Remove close listener
            resolve(response);
          }
        } catch (error) {
          console.error(`Error processing message for request ${tunnelRequest.id}:`, error);
        }
      };
  
      const handleClose = () => {
        clearTimeout(pendingRequest.timer);
        this.getPendingRequests(client).delete(tunnelRequest.id);
        client.off('message', handleMessage); // Remove message listener
        client.off('close', handleClose); // Remove close listener
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

  private registerClient(ws: WebSocket, message: RegisterMessage): void {
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
    
    const registeredMessage: ServerMessage = {
      type: 'registered',
      url: `https://${subdomain}.${this.domainName.replace(/^https?:\/\//, '')}` // Correct URL format
    };
    
    ws.send(JSON.stringify(registeredMessage));
    console.log(`Client registered with subdomain: ${subdomain}`);
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