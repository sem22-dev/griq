import { gunzipSync } from 'zlib';
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
  private maxMessageSize: number = 1024 * 1024; // 1MB default max message size

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
    const options: http.RequestOptions = {
      hostname: 'localhost',
      port: this.localPort,
      path: request.path,
      method: request.method,
      headers: request.headers
    };
    
    const req = http.request(options, (res) => {
      console.log(`[${request.id}] Response status:`, res.statusCode);
      console.log(`[${request.id}] Response headers:`, res.headers);
      
      const chunks: Buffer[] = [];
      let totalSize = 0;
      
      res.on('data', (chunk) => {
        console.log(`[${request.id}] Received chunk of size ${chunk.length} bytes`);
        chunks.push(chunk);
        totalSize += chunk.length;
      });
      
      res.on('end', () => {
        console.log(`[${request.id}] Response complete, total size: ${totalSize} bytes`);
        
        try {
          const fullResponseBody = Buffer.concat(chunks);
          
          const isGzip = res.headers['content-encoding']?.toLowerCase() === 'gzip';
          let decompressedBody: Buffer;
          if (isGzip) {
            decompressedBody = gunzipSync(fullResponseBody);
            console.log(`[${request.id}] Decompressed gzip response, size: ${decompressedBody.length} bytes`);
          } else {
            decompressedBody = fullResponseBody;
          }
          
          const response: TunnelResponse = {
            id: request.id,
            statusCode: res.statusCode || 500,
            headers: this.cleanupHeaders(res.headers),
            body: decompressedBody
          };
          
          console.log(`[${request.id}] Sending complete response of ${decompressedBody.length} bytes`);
          if (this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'tunnel', data: response }));
          } else {
            console.error(`[${request.id}] WebSocket closed, cannot send response`);
          }
        } catch (error) {
          console.error(`[${request.id}] Error preparing response:`, error);
          this.sendErrorResponse(request.id, 'Internal Server Error');
        }
      });
      
      res.on('error', (error) => {
        console.error(`[${request.id}] Response error:`, error);
        this.sendErrorResponse(request.id, 'Bad Gateway');
      });
    });
    
    req.on('error', (error) => {
      console.error(`[${request.id}] Request error:`, error);
      this.sendErrorResponse(request.id, 'Bad Gateway');
    });
    
    if (request.body) {
      req.write(request.body);
    }
    req.end();
  }
  
  private cleanupHeaders(headers: http.IncomingHttpHeaders): Record<string, string> {
    const cleanHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (value !== undefined) {
        cleanHeaders[key] = Array.isArray(value) ? value.join(', ') : String(value);
      }
    }
    return cleanHeaders;
  }

  private sendErrorResponse(requestId: string, message: string): void {
    const response: TunnelResponse = {
      id: requestId,
      statusCode: 502,
      headers: { 'content-type': 'text/plain' },
      body: Buffer.from(message)
    };
    
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'tunnel', data: response }));
    }
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