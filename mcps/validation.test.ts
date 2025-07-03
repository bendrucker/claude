import { describe, it, expect, beforeAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { McpConfigManager } from './install.js';

describe('MCP Configuration Validation', () => {
  let configManager: McpConfigManager;
  let localMcps: Array<{ name: string; type: string; config: any }>;

  beforeAll(async () => {
    configManager = new McpConfigManager();
    await configManager.init();
    localMcps = configManager.getLocal();
  });

  describe('config structure', () => {
    it('should load MCP configurations without errors', () => {
      expect(configManager).toBeDefined();
    });

    it('should have non-HTTP MCP servers available', () => {
      expect(localMcps.length).toBeGreaterThan(0);
    });
  });

  describe('MCP server validation', () => {
    it('should start each local MCP and list tools', async () => {
      const filteredMcps = localMcps.filter(({ name }) => 
        // Skip docker in CI and typescript language server (requires specific setup)
        !(process.env.CI && name === 'terraform') && 
        name !== 'language-server-typescript'
      );

      expect(filteredMcps.length).toBeGreaterThan(0);

      for (const { name, config } of filteredMcps) {
        await testMcpServer(name, config);
      }
    }, 60000); // 1 minute timeout for all tests
  });
});

async function testMcpServer(name: string, config: any) {
  console.log(`Testing MCP: ${name}`);
  
  expect(config.command).toBeDefined();
  expect(config.args).toBeDefined();

  const transport = new StdioClientTransport({
    command: config.command!,
    args: config.args!,
    env: config.env || {}
  });

  const client = new Client({
    name: 'test-client',
    version: '1.0.0'
  }, {
    capabilities: {}
  });

  try {
    await client.connect(transport);
    
    // List tools to verify the MCP is working
    const tools = await client.listTools();
    
    expect(tools).toBeDefined();
    expect(Array.isArray(tools.tools)).toBe(true);
    
    console.log(`✓ ${name} connected successfully with ${tools.tools.length} tools available`);
    
  } catch (error) {
    // Handle common setup issues gracefully
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    if (errorMessage.includes('ENOENT') || errorMessage.includes('spawn')) {
      const command = config.command;
      console.warn(`⚠ ${name} requires ${command} to be installed - skipping in this environment`);
      return; // Skip this test instead of failing
    }
    
    // Log detailed error information for debugging
    console.error(`✗ Failed to connect to ${name}:`, error);
    throw new Error(`MCP ${name} failed: ${errorMessage}`);
  } finally {
    try {
      await client.close();
    } catch {
      // Ignore cleanup errors
    }
  }
}