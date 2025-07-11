import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { ServerConfig } from './config.js';

export interface ServerInfo {
  name: string;
  config: ServerConfig;
}

export interface ToolResult {
  name: string;
  success: boolean;
  tools?: string[];
  error?: string;
  output?: string;
}

const DEFAULT_TIMEOUT = process.env.CI ? 60000 : 10000;
const CLIENT_INFO = {
  name: 'mcps-tools-discovery',
  version: '1.0.0'
} as const;

/**
 * Tools discovery class for querying MCP servers and listing their available tools.
 */
export class Tools {
  private servers: ServerInfo[] = [];

  /**
   * Creates a new Tools instance with the given server configurations.
   * @param servers Record of server names to their configurations
   */
  constructor(servers: Record<string, ServerConfig>) {
    for (const [name, config] of Object.entries(servers)) {
      this.servers.push({ name, config });
    }
  }

  /**
   * Returns the list of configured servers.
   */
  getServers(): ServerInfo[] {
    return this.servers;
  }

  private createTransport(server: ServerInfo) {
    const { config } = server;
    
    switch (config.type) {
      case 'stdio':
        if (!config.command) {
          throw new Error(`Server '${server.name}' missing required 'command' field`);
        }
        return new StdioClientTransport({
          command: config.command,
          args: config.args || [],
          env: { ...process.env, ...config.env } as Record<string, string>,
          cwd: config.cwd
        });
      case 'http':
        if (!config.url) {
          throw new Error(`Server '${server.name}' missing required 'url' field`);
        }
        return new StreamableHTTPClientTransport(
          new URL(config.url),
          {
            requestInit: {
              headers: config.headers
            }
          }
        );
      default:
        throw new Error(`Unknown server type: ${config.type}`);
    }
  }

  private async queryServerTools(server: ServerInfo): Promise<ToolResult> {
    const result: ToolResult = { name: server.name, success: false };
    let client: Client | null = null;
    
    try {
      client = new Client(CLIENT_INFO, { capabilities: {} });
      const transport = this.createTransport(server);

      await client.connect(transport, { timeout: DEFAULT_TIMEOUT });
      const toolsResponse = await client.listTools({ timeout: DEFAULT_TIMEOUT });
      
      result.success = true;
      result.tools = toolsResponse.tools?.map(tool => tool.name) || [];
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
    } finally {
      // Ensure client is always closed
      if (client) {
        try {
          await client.close();
        } catch (closeError) {
          // Log but don't throw, as we want the original result
          console.warn(`Failed to close client for ${server.name}:`, closeError);
        }
      }
    }

    return result;
  }

  /**
   * Queries multiple MCP servers in parallel to discover their available tools.
   * @param servers Array of servers to query
   * @returns Promise resolving to an array of tool discovery results
   */
  async queryServersParallel(servers: ServerInfo[]): Promise<ToolResult[]> {
    return Promise.all(
      servers.map(server => this.queryServerTools(server))
    );
  }
}