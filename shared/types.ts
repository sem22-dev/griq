
// shared/types.ts

// Messages from client to server
export interface RegisterMessage {
    type: 'register';
    port: number;
    subdomain?: string;
  }
  
  export interface ClientMessage {
    type: 'register' | 'tunnel' | 'ping';
    data?: any;
  }
  
  // Messages from server to client
  export interface ServerMessage {
    type: 'registered' | 'tunnel' | 'error';
    url?: string;
    message?: string;
    data?: any;
  }
  
  // Tunnel request from server to client
  export interface TunnelRequest {
    id: string;
    method: string;
    path: string;
    headers: Record<string, string>;
    body?: Buffer;
  }
  
  // Tunnel response from client to server
  export interface TunnelResponse {
    id: string;
    statusCode: number;
    headers: Record<string, string>;
    body?: Buffer;
  }