
// shared/utils.ts

import crypto from 'crypto';

// Generate a random ID for requests
export function generateId(): string {
  return crypto.randomBytes(8).toString('hex');
}

// Generate a random subdomain if none is provided
export function generateSubdomain(): string {
  // Generate a random 6-character subdomain
  const adjectives = ['happy', 'quick', 'smart', 'bright', 'cool', 'fast', 'great'];
  const nouns = ['fox', 'wolf', 'bear', 'lion', 'tiger', 'eagle', 'hawk'];
  
  const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const number = Math.floor(Math.random() * 1000);
  
  return `${adjective}-${noun}-${number}`;
}

// Validate subdomain (letters, numbers, and hyphens only)
export function validateSubdomain(subdomain: string): boolean {
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i.test(subdomain);
}