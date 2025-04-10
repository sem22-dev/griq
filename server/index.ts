

import { TunnelServer } from './server';
import * as dotenv from 'dotenv';
dotenv.config(); // Load .env file

// Default port for the tunnel server
const PORT = parseInt(process.env.PORT || '8000', 10);
const DOMAIN_NAME = process.env.DOMAIN_NAME || 'localhost:8000';

// Create and start the tunnel server
const server = new TunnelServer({
  port: PORT,
  domainName: DOMAIN_NAME
});

// Handle termination signals
process.on('SIGINT', () => {
  console.log('Shutting down server...');
  server.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Shutting down server...');
  server.close();
  process.exit(0);
});

console.log(`NTNL server started on port ${PORT}`);
console.log(`Using domain: ${DOMAIN_NAME}`);
