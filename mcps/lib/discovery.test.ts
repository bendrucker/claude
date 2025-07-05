import { test } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import pRetry from 'p-retry';
import { Tools } from './discovery.js';
import type { ServerConfig } from './config.js';
import type { TestContext } from 'node:test';

const RETRY_OPTIONS = {
  retries: 10,
  minTimeout: 100,
  maxTimeout: 1000,
  factor: 1.5
} as const;

test('Tools should discover tools from stdio MCP server', async () => {
  const serverConfigs: Record<string, ServerConfig> = {
    'fake-stdio-server': {
      type: 'stdio',
      command: 'npx',
      args: ['tsx', 'lib/fakes/stdio.ts'],
      env: {}
    }
  };

  const tools = new Tools(serverConfigs);
  const servers = tools.getServers();
  
  assert.strictEqual(servers.length, 1);
  assert.strictEqual(servers[0].name, 'fake-stdio-server');
  
  const results = await tools.queryServersParallel(servers);
  
  assert.strictEqual(results.length, 1);
  const result = results[0];
  assert.strictEqual(result.name, 'fake-stdio-server');
  assert.strictEqual(result.success, true);
  assert(Array.isArray(result.tools));
  assert.strictEqual(result.tools!.length, 1);
  assert.strictEqual(result.tools![0], 'stdio-test-tool');
});

test('Tools should discover tools from HTTP MCP server', async (t: TestContext) => {
  // Start HTTP server
  const httpServer = spawn(process.execPath, ['--import', 'tsx', 'lib/fakes/http.ts', '3337'], {
    stdio: 'ignore'
  });

  t.after(async () => {
    httpServer.kill('SIGTERM');
    
    // Wait for process to exit
    try {
      await once(httpServer, 'exit');
    } catch {
      // If it doesn't exit gracefully, force kill
      httpServer.kill('SIGKILL');
    }
  });

  const serverConfigs: Record<string, ServerConfig> = {
    'fake-http-server': {
      type: 'http',
      url: 'http://localhost:3337'
    }
  };

  const tools = new Tools(serverConfigs);
  const servers = tools.getServers();
  
  assert.strictEqual(servers.length, 1);
  assert.strictEqual(servers[0].name, 'fake-http-server');
  
  // Wait for server to be ready and test tools discovery with retry
  const results = await pRetry(
    async () => {
      const results = await tools.queryServersParallel(servers);
      if (!results[0].success) {
        throw new Error(`Server not ready: ${results[0].error}`);
      }
      return results;
    },
    RETRY_OPTIONS
  );
  
  assert.strictEqual(results.length, 1);
  const result = results[0];
  assert.strictEqual(result.name, 'fake-http-server');
  assert.strictEqual(result.success, true);
  assert(Array.isArray(result.tools));
  assert.strictEqual(result.tools!.length, 1);
  assert.strictEqual(result.tools![0], 'http-test-tool');
});

test('Tools should handle HTTP server failures', async () => {
  const serverConfigs: Record<string, ServerConfig> = {
    'nonexistent-http-server': {
      type: 'http',
      url: 'http://localhost:9999'
    }
  };

  const tools = new Tools(serverConfigs);
  const servers = tools.getServers();
  
  assert.strictEqual(servers.length, 1);
  assert.strictEqual(servers[0].name, 'nonexistent-http-server');
  
  const results = await tools.queryServersParallel(servers);
  
  assert.strictEqual(results.length, 1);
  const result = results[0];
  assert.strictEqual(result.name, 'nonexistent-http-server');
  assert.strictEqual(result.success, false);
  assert(result.error);
});

