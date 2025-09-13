// src/middleware/rateLimiter.ts
import { Request, Response, NextFunction } from 'express';

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

export class RateLimiter {
  private store: Map<string, RateLimitEntry> = new Map();
  private windowMs: number;
  private maxRequests: number;
  private cleanupInterval: NodeJS.Timeout;

  constructor(windowMs: number = 60000, maxRequests: number = 60) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    
    // Clean up expired entries every 5 minutes
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.store.entries()) {
        if (now > entry.resetTime) {
          this.store.delete(key);
        }
      }
    }, 5 * 60 * 1000);
  }

  checkLimit(key: string): { allowed: boolean; remaining: number; resetTime: number; retryAfter?: number } {
    const now = Date.now();
    let entry = this.store.get(key);

    if (!entry || now > entry.resetTime) {
      entry = {
        count: 0,
        resetTime: now + this.windowMs
      };
      this.store.set(key, entry);
    }

    const allowed = entry.count < this.maxRequests;
    const remaining = Math.max(0, this.maxRequests - entry.count - 1);
    const retryAfter = allowed ? undefined : Math.ceil((entry.resetTime - now) / 1000);

    if (allowed) {
      entry.count++;
    }

    return {
      allowed,
      remaining,
      resetTime: entry.resetTime,
      retryAfter
    };
  }

  middleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      const clientIp = this.extractClientIp(req);
      
      // Skip rate limiting for health check and static files
      if (req.path === '/health' || req.path.startsWith('/dist/bin/')) {
        return next();
      }

      const result = this.checkLimit(clientIp);

      // Set rate limit headers
      res.set({
        'X-RateLimit-Limit': this.maxRequests.toString(),
        'X-RateLimit-Remaining': result.remaining.toString(),
        'X-RateLimit-Reset': new Date(result.resetTime).toISOString(),
        ...(result.retryAfter && { 'Retry-After': result.retryAfter.toString() })
      });

      if (!result.allowed) {
        return res.status(429).json({
          error: 'Rate limit exceeded',
          message: `Too many requests from ${clientIp}. Try again in ${result.retryAfter} seconds.`,
          retryAfter: result.retryAfter
        });
      }

      next();
    };
  }

  private extractClientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    const realIp = req.headers['x-real-ip'];
    const cfConnectingIp = req.headers['cf-connecting-ip'];
    
    let ip = (cfConnectingIp || realIp || forwarded || req.socket.remoteAddress) as string;
    
    if (ip && ip.includes(',')) {
      ip = ip.split(',')[0].trim();
    }
    
    return ip || 'unknown';
  }

  getStats() {
    return {
      activeEntries: this.store.size,
      windowMs: this.windowMs,
      maxRequests: this.maxRequests
    };
  }

  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.store.clear();
  }
}

export class TunnelRateLimiter {
  private subdomainCreationLimiter: RateLimiter;
  private clientRequestLimiters: Map<string, RateLimitEntry> = new Map();
  private concurrentConnections: Map<string, Set<string>> = new Map();
  
  private readonly CLIENT_REQUEST_WINDOW = 60 * 1000; // 1 minute
  private readonly MAX_CLIENT_REQUESTS = 120;
  private readonly MAX_CONCURRENT_TUNNELS = 3;

  constructor() {
    // Rate limiter for subdomain creation (5 per hour per IP)
    this.subdomainCreationLimiter = new RateLimiter(60 * 60 * 1000, 5);

    // Clean up client request limiters every 10 minutes
    setInterval(() => {
      const now = Date.now();
      for (const [subdomain, entry] of this.clientRequestLimiters.entries()) {
        if (now > entry.resetTime + 10 * 60 * 1000) {
          this.clientRequestLimiters.delete(subdomain);
        }
      }
    }, 10 * 60 * 1000);
  }

  checkSubdomainCreation(clientIp: string): boolean {
    return this.subdomainCreationLimiter.checkLimit(clientIp).allowed;
  }

  checkConcurrentTunnels(clientIp: string): boolean {
    const connections = this.concurrentConnections.get(clientIp);
    return !connections || connections.size < this.MAX_CONCURRENT_TUNNELS;
  }

  addTunnelConnection(clientIp: string, subdomain: string): void {
    if (!this.concurrentConnections.has(clientIp)) {
      this.concurrentConnections.set(clientIp, new Set());
    }
    this.concurrentConnections.get(clientIp)!.add(subdomain);
  }

  removeTunnelConnection(clientIp: string, subdomain: string): void {
    const connections = this.concurrentConnections.get(clientIp);
    if (connections) {
      connections.delete(subdomain);
      if (connections.size === 0) {
        this.concurrentConnections.delete(clientIp);
      }
    }
  }

  checkClientRequest(subdomain: string): boolean {
    const now = Date.now();
    let entry = this.clientRequestLimiters.get(subdomain);

    if (!entry || now > entry.resetTime) {
      entry = {
        count: 0,
        resetTime: now + this.CLIENT_REQUEST_WINDOW
      };
      this.clientRequestLimiters.set(subdomain, entry);
    }

    if (entry.count >= this.MAX_CLIENT_REQUESTS) {
      return false;
    }

    entry.count++;
    return true;
  }

  getStats() {
    return {
      subdomainCreation: this.subdomainCreationLimiter.getStats(),
      activeClientLimiters: this.clientRequestLimiters.size,
      activeConcurrentConnections: this.concurrentConnections.size,
      totalConcurrentTunnels: Array.from(this.concurrentConnections.values())
        .reduce((sum, set) => sum + set.size, 0)
    };
  }

  destroy(): void {
    this.subdomainCreationLimiter.destroy();
    this.clientRequestLimiters.clear();
    this.concurrentConnections.clear();
  }
}