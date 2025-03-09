


import WebSocket from 'ws';
import * as http from 'http';
import { EventEmitter } from 'events';
import { TunnelRequest, TunnelResponse, RegisterMessage, ClientMessage, ServerMessage } from '../shared/types';

export class TunnelClient extends EventEmitter {
  private ws!: WebSocket;
  private pendingRequests: Map<string, (response: TunnelResponse) => void> = new Map();
  private localPort: number;
  private publicUrl: string = '';
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectTimeout?: NodeJS.Timeout;

  constructor(serverUrl: string, localPort: number, subdomain?: string) {
    super();
    this.localPort = localPort;
    this.connectToServer(serverUrl, subdomain);
  }

  private connectToServer(serverUrl: string, subdomain?: string): void {
    this.emit('connecting');
    this.ws = new WebSocket(serverUrl);
    
    this.ws.on('open', () => {
      this.reconnectAttempts = 0;
      this.emit('connected');
      console.log('Connected to tunnel server');
      
      // Register with the server
      const registerMessage: RegisterMessage = {
        type: 'register',
        port: this.localPort,
        subdomain
      };
      
      this.ws.send(JSON.stringify(registerMessage));
    });
    
    this.ws.on('message', (data: WebSocket.Data) => {
      try {
        const message = JSON.parse(data.toString()) as ServerMessage;
        
        if (message.type === 'registered') {
          this.publicUrl = message.url as string;
          console.log(`Tunnel established at: ${this.publicUrl}`);
          this.emit('registered', this.publicUrl);
        } else if (message.type === 'tunnel') {
          this.handleTunnelRequest(message.data as TunnelRequest);
        } else if (message.type === 'error') {
          console.error(`Server error: ${message.message}`);
          this.emit('error', new Error(message.message));
        }
      } catch (error) {
        console.error('Error parsing message:', error);
      }
    });
    
    this.ws.on('close', () => {
      console.log('Disconnected from tunnel server');
      this.emit('disconnected');
      this.attemptReconnect(serverUrl, subdomain);
    });
    
    this.ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      this.emit('error', error);
    });
  }

  private attemptReconnect(serverUrl: string, subdomain?: string): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
      
      console.log(`Attempting to reconnect in ${delay/1000} seconds... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      
      this.reconnectTimeout = setTimeout(() => {
        this.connectToServer(serverUrl, subdomain);
      }, delay);
    } else {
      console.error('Maximum reconnection attempts reached');
      this.emit('error', new Error('Maximum reconnection attempts reached'));
    }
  }
  
  private handleTunnelRequest(request: TunnelRequest): void {
    // Forward the request to the local server
    const options: http.RequestOptions = {
      hostname: 'localhost',
      port: this.localPort,
      path: request.path,
      method: request.method,
      headers: request.headers
    };
    
    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];
      
      res.on('data', (chunk) => {
        chunks.push(Buffer.from(chunk));
      });
      
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        const response: TunnelResponse = {
          id: request.id,
          statusCode: res.statusCode || 500,
          headers: res.headers as Record<string, string>,
          body
        };
        
        const message: ClientMessage = {
          type: 'tunnel',
          data: response
        };
        
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify(message));
        } else {
          console.error('WebSocket not open, unable to send response');
        }
      });
    });
    
    req.on('error', (error) => {
      console.error('Error forwarding request:', error);
      
      const response: TunnelResponse = {
        id: request.id,
        statusCode: 502,
        headers: { 'content-type': 'text/plain' },
        body: Buffer.from('Bad Gateway')
      };
      
      const message: ClientMessage = {
        type: 'tunnel',
        data: response
      };
      
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(message));
      }
    });
    
    if (request.body) {
      req.write(request.body);
    }
    
    req.end();
  }
  
  public getPublicUrl(): string {
    return this.publicUrl;
  }
  
  public close(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
    
    this.removeAllListeners();
  }
}