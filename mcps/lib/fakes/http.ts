import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import http from 'http';
import { randomUUID } from 'crypto';

const server = new Server({
  name: 'fake-http-mcp-server', 
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
        name: 'http-test-tool',
        description: 'A test tool for HTTP',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      }
    ]
  };
});

const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => randomUUID()
});

await server.connect(transport);

const httpServer = http.createServer(async (req, res) => {
  await transport.handleRequest(req, res);
});

const port = parseInt(process.argv[2]) || 3333;
httpServer.listen(port, () => {
  console.log(`Fake HTTP MCP server listening on port ${port}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully');
  httpServer.close(() => {
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down gracefully');
  httpServer.close(() => {
    process.exit(0);
  });
});