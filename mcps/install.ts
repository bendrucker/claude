#!/usr/bin/env npx tsx

import { readFile, writeFile, access } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execa } from 'execa';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { homedir } from 'os';

// Types and interfaces
interface EnvConfig {
  env?: Record<string, string>;
}

interface HttpConfig {
  url: string;
  headers?: Record<string, string>;
}

interface GoConfig extends EnvConfig {
  module: string;
}

interface UvxConfig extends EnvConfig {
  package: string;
}

interface NpmConfig extends EnvConfig {
  package: string;
  binary?: string;
}

interface DockerConfig extends EnvConfig {
  service: string;
}

interface McpConfigs {
  http?: { [name: string]: HttpConfig };
  go?: { [name: string]: GoConfig };
  uvx?: { [name: string]: UvxConfig };
  npm?: { [name: string]: NpmConfig };
  docker?: { [name: string]: DockerConfig };
}

interface McpServerConfig {
  type: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

interface ClaudeDesktopConfig {
  mcpServers: Record<string, McpServerConfig>;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

// Timer constants
const TIMER_LOAD_CONFIG = 'Load ~/.claude.json';
const TIMER_WRITE_CONFIG = 'Write ~/.claude.json';

class McpInstaller {
  private mcpsConfig: string;
  private composeFile: string;
  private configs: McpConfigs;
  private existingMcpServers: Record<string, McpServerConfig> | null = null;

  constructor() {
    this.mcpsConfig = join(__dirname, 'mcps.json');
    this.composeFile = join(__dirname, 'docker-compose.yml');
    this.configs = {};
  }

  // Configuration generators
  private readonly configGenerators = {
    http: (config: HttpConfig): McpServerConfig => ({
      type: 'http',
      url: config.url,
      ...(config.headers && { headers: config.headers })
    }),
    go: (config: GoConfig): McpServerConfig => ({
      type: 'stdio',
      command: 'go',
      args: ['-C', __dirname, 'tool', config.module],
      env: config.env || {}
    }),
    uvx: (config: UvxConfig): McpServerConfig => ({
      type: 'stdio',
      command: 'uvx',
      args: ['--directory', __dirname, config.package],
      env: config.env || {}
    }),
    npm: (config: NpmConfig): McpServerConfig => ({
      type: 'stdio',
      command: 'npx',
      args: ['--prefix', __dirname, '--no-install', config.binary || config.package],
      env: config.env || {}
    }),
    docker: async (config: DockerConfig): Promise<McpServerConfig> => {
      const composeEnv = await this.getDockerComposeEnv(config.service);
      const mergedEnv = { ...composeEnv, ...config.env };

      return {
        type: 'stdio',
        command: 'docker-compose',
        args: ['--file', this.composeFile, 'run', '--rm', config.service],
        env: mergedEnv
      };
    }
  };

  async init(): Promise<void> {
    try {
      await access(this.mcpsConfig);
    } catch {
      throw new Error(`${this.mcpsConfig} not found`);
    }

    const configData = await readFile(this.mcpsConfig, 'utf-8');
    this.configs = JSON.parse(configData);

    // Validate configuration structure
    const validTypes = Object.keys(this.configGenerators);
    for (const type of Object.keys(this.configs)) {
      if (!validTypes.includes(type)) {
        throw new Error(`Invalid MCP type '${type}'. Valid types: ${validTypes.join(', ')}`);
      }
    }
  }

  // Utility methods
  private async envsubst(text: string): Promise<string> {
    return (await execa('envsubst', { input: text })).stdout;
  }

  private async getDockerComposeEnv(service: string): Promise<Record<string, string>> {
    try {
      // Get service config as JSON
      const { stdout: configJson } = await execa('docker-compose', ['--file', this.composeFile, 'config', '--format', 'json']);
      const config = JSON.parse(configJson);

      // Check if service exists
      if (!config.services || !config.services[service]) {
        return {};
      }

      const serviceConfig = config.services[service];
      const environment = serviceConfig.environment;

      if (!environment) {
        return {};
      }

      if (Array.isArray(environment)) {
        const env: Record<string, string> = {};
        for (const item of environment) {
          if (typeof item === 'string') {
            if (item.includes('=')) {
              const [key, ...valueParts] = item.split('=');
              env[key] = valueParts.join('=');
            } else {
              // Just a key, get value from process.env
              env[item] = process.env[item] || '';
            }
          }
        }
        return env;
      } else if (typeof environment === 'object') {
        return environment;
      }

      return {};
    } catch {
      return {};
    }
  }

  private async generateMcpConfig(type: string, config: HttpConfig | GoConfig | UvxConfig | NpmConfig | DockerConfig): Promise<McpServerConfig> {
    const generator = this.configGenerators[type as keyof typeof this.configGenerators];
    if (!generator) {
      throw new Error(`Unknown MCP type: ${type}`);
    }

    // Handle docker as special case since it's async
    if (type === 'docker') {
      return await generator(config as DockerConfig);
    }

    return generator(config as any);
  }

  private async checkMissingEnvVars(configJson: string): Promise<string[]> {
    try {
      const { stdout } = await execa('envsubst', ['--variables', configJson]);
      const vars = stdout.split('\n').filter(Boolean);

      return vars.filter((varName: string) => !process.env[varName]);
    } catch {
      return [];
    }
  }

  private async processConfig(type: string, config: HttpConfig | GoConfig | UvxConfig | NpmConfig | DockerConfig): Promise<McpServerConfig> {
    const generated = await this.generateMcpConfig(type, config);

    if (type === 'http') {
      // For HTTP, substitute variables in headers rather than adding env
      const configJson = JSON.stringify(generated);

      // Check for missing environment variables in HTTP configs too
      const missingVars = await this.checkMissingEnvVars(configJson);
      if (missingVars.length > 0) {
        throw new Error(`Missing required environment variables for HTTP config: ${missingVars.join(', ')}`);
      }

      const interpolated = await this.envsubst(configJson);
      return JSON.parse(interpolated) as McpServerConfig;
    }

    return generated;
  }

  async printConfig(): Promise<void> {
    const mcpServers: Record<string, McpServerConfig> = {};

    for (const [type, typeConfigs] of Object.entries(this.configs)) {
      if (!typeConfigs) continue;

      for (const [name, config] of Object.entries(typeConfigs)) {
        try {
          mcpServers[name] = await this.processConfig(type, config as HttpConfig | GoConfig | UvxConfig | NpmConfig | DockerConfig);
        } catch (error) {
          console.error(`Error processing '${name}':`, error instanceof Error ? error.message : error);
          process.exit(1);
        }
      }
    }

    const desktopConfig: ClaudeDesktopConfig = { mcpServers };
    console.log(JSON.stringify(desktopConfig, null, 2));
  }


  private async getExistingMcps(): Promise<Set<string>> {
    await this.loadExistingMcpServers();
    return new Set(Object.keys(this.existingMcpServers || {}));
  }

  private async loadExistingMcpServers(): Promise<void> {
    if (this.existingMcpServers !== null) return; // Already loaded

    const claudeConfigPath = join(homedir(), '.claude.json');
    console.time(TIMER_LOAD_CONFIG);

    try {
      const content = await readFile(claudeConfigPath, 'utf-8');
      const config = JSON.parse(content) as ClaudeDesktopConfig;
      this.existingMcpServers = config.mcpServers || {};
      console.timeEnd(TIMER_LOAD_CONFIG);
    } catch {
      this.existingMcpServers = {};
      console.timeEnd(TIMER_LOAD_CONFIG);
    }
  }

  private async getMcpConfig(name: string): Promise<McpServerConfig | null> {
    await this.loadExistingMcpServers();
    return this.existingMcpServers?.[name] || null;
  }

  private configsEqual(renderedConfig: McpServerConfig, liveConfig: McpServerConfig | null): boolean {
    if (!liveConfig) return false;
    return JSON.stringify(renderedConfig) === JSON.stringify(liveConfig);
  }

  async install(): Promise<void> {
    const claudeConfigPath = join(homedir(), '.claude.json');

    // Load existing config
    console.time(TIMER_LOAD_CONFIG);
    let claudeConfig: ClaudeDesktopConfig;
    try {
      const content = await readFile(claudeConfigPath, 'utf-8');
      claudeConfig = JSON.parse(content);
      console.timeEnd(TIMER_LOAD_CONFIG);
    } catch {
      claudeConfig = { mcpServers: {} };
      console.timeEnd(TIMER_LOAD_CONFIG);
    }

    // Process all configs
    const newMcpServers: Record<string, McpServerConfig> = {};

    for (const [type, typeConfigs] of Object.entries(this.configs)) {
      if (!typeConfigs) continue;

      for (const [name, config] of Object.entries(typeConfigs)) {
        const generated = await this.generateMcpConfig(type, config as HttpConfig | GoConfig | UvxConfig | NpmConfig | DockerConfig);

        // Check for missing environment variables for all types
        const configJson = JSON.stringify(generated);
        const missingVars = await this.checkMissingEnvVars(configJson);
        if (missingVars.length > 0) {
          console.error(`Error: Missing required environment variables for '${name}':`);
          missingVars.forEach(varName => console.error(`  ${varName}`));
          process.exit(1);
        }

        try {
          newMcpServers[name] = await this.processConfig(type, config as HttpConfig | GoConfig | UvxConfig | NpmConfig | DockerConfig);
          console.log(`Configured MCP server: ${name}`);
        } catch (error) {
          console.error(`Failed to process MCP server '${name}':`, error);
          process.exit(1);
        }
      }
    }

    // Update the config with new mcpServers
    claudeConfig.mcpServers = newMcpServers;

    // Write back to file
    console.time(TIMER_WRITE_CONFIG);
    await writeFile(claudeConfigPath, JSON.stringify(claudeConfig, null, 2));
    console.timeEnd(TIMER_WRITE_CONFIG);
  }
}

async function main() {
  const args = await yargs(hideBin(process.argv))
    .option('print', {
      type: 'boolean',
      description: 'Print MCP configuration as JSON (compatible with Claude Desktop)',
      default: false
    })
    .help()
    .argv;

  try {
    const installer = new McpInstaller();
    await installer.init();

    if (args.print) {
      await installer.printConfig();
    } else {
      await installer.install();
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
