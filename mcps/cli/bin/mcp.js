#!/usr/bin/env node

import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// Register tsx to handle TypeScript imports
try {
  const { register } = await import('../node_modules/tsx/dist/esm/api/index.mjs');
  register();
} catch (error) {
  // Fallback to tsx/esm for global installation
  try {
    const { register } = await import('tsx/esm');
    register();
  } catch {
    console.error('Error: tsx is required but not found. Please install tsx.');
    process.exit(1);
  }
}

// Import and run the TypeScript CLI
await import('./mcp.ts');