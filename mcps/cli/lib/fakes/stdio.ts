import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server({
  name: 'fake-stdio-mcp-server',
  version: '1.0.0'
}, {
  capabilities: {
    tools: {}
  }
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'stdio-test-tool',
        description: 'A test tool for stdio',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      }
    ]
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);

// Exit when stdin is closed (normal for stdio servers)
process.stdin.on('end', () => {
  process.exit(0);
});

process.stdin.on('close', () => {
  process.exit(0);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  process.exit(0);
});

process.on('SIGINT', () => {
  process.exit(0);
});