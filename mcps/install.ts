#!/usr/bin/env npx tsx

import { readFile, writeFile, access } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execa } from 'execa';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { homedir } from 'os';

import { 
  Configs, 
  ServerConfig, 
  ClaudeDesktopConfig, 
  AnyConfig,
  createServerConfig 
} from './lib/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Timer constants
const TIMER_LOAD_CONFIG = 'Load ~/.claude.json';
const TIMER_WRITE_CONFIG = 'Write ~/.claude.json';

class Installer {
  private configPath: string;
  private composeFile: string;
  private configs: Configs;
  private dockerComposeEnvs: Record<string, Record<string, string>> = {};
  private existingServers: Record<string, ServerConfig> | null = null;

  constructor() {
    this.configPath = join(__dirname, 'mcps.json');
    this.composeFile = join(__dirname, 'docker-compose.yml');
    this.configs = {};
  }


  async init(): Promise<void> {
    try {
      await access(this.configPath);
    } catch {
      throw new Error(`${this.configPath} not found`);
    }

    const configData = await readFile(this.configPath, 'utf-8');
    this.configs = JSON.parse(configData);

    // Validate configuration structure
    const validTypes = ['http', 'go', 'uvx', 'npm', 'docker'];
    for (const type of Object.keys(this.configs)) {
      if (!validTypes.includes(type)) {
        throw new Error(`Invalid MCP type '${type}'. Valid types: ${validTypes.join(', ')}`);
      }
    }

    // Pre-load Docker Compose environments
    await this.loadDockerComposeEnvs();
  }

  // Utility methods
  private async envsubst(text: string): Promise<string> {
    return (await execa('envsubst', { input: text })).stdout;
  }

  private async loadDockerComposeEnvs(): Promise<void> {
    if (!this.configs.docker) return;

    try {
      // Load docker-compose config once
      const { stdout: configJson } = await execa('docker', ['compose', '--file', this.composeFile, 'config', '--format', 'json']);
      const composeConfig = JSON.parse(configJson);

      // Extract environment for each service
      for (const serviceName of Object.keys(this.configs.docker)) {
        this.dockerComposeEnvs[serviceName] = this.extractServiceEnv(composeConfig, serviceName);
      }
    } catch {
      // If docker-compose config fails, set empty envs for all services
      for (const serviceName of Object.keys(this.configs.docker)) {
        this.dockerComposeEnvs[serviceName] = {};
      }
    }
  }

  private extractServiceEnv(composeConfig: any, serviceName: string): Record<string, string> {
    if (!composeConfig.services || !composeConfig.services[serviceName]) {
      return {};
    }

    const serviceConfig = composeConfig.services[serviceName];
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
  }


  private generateConfig(type: string, config: AnyConfig): ServerConfig {
    return createServerConfig(type, config, this.dockerComposeEnvs);
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

  private async processConfig(type: string, config: AnyConfig): Promise<ServerConfig> {
    const generated = this.generateConfig(type, config);
    const configJson = JSON.stringify(generated);

    // Check for missing environment variables for all types
    const missingVars = await this.checkMissingEnvVars(configJson);
    if (missingVars.length > 0) {
      throw new Error(`Missing required environment variables for ${type} config: ${missingVars.join(', ')}`);
    }

    // Perform envsubst on all server types
    const interpolated = await this.envsubst(configJson);
    return JSON.parse(interpolated) as ServerConfig;
  }

  async printConfig(): Promise<void> {
    const mcpServers: Record<string, ServerConfig> = {};

    for (const [type, typeConfigs] of Object.entries(this.configs)) {
      if (!typeConfigs) continue;

      for (const [name, config] of Object.entries(typeConfigs)) {
        try {
          mcpServers[name] = await this.processConfig(type, config as AnyConfig);
        } catch (error) {
          console.error(`Error processing '${name}':`, error instanceof Error ? error.message : error);
          process.exit(1);
        }
      }
    }

    const desktopConfig: ClaudeDesktopConfig = { mcpServers };
    console.log(JSON.stringify(desktopConfig, null, 2));
  }

  private findByName(name: string): { type: string; config: AnyConfig } | null {
    for (const [type, typeConfigs] of Object.entries(this.configs)) {
      if (!typeConfigs) continue;
      
      if (typeConfigs[name]) {
        return { type, config: typeConfigs[name] as AnyConfig };
      }
    }
    return null;
  }

  private listAvailable(): string[] {
    const mcpNames: string[] = [];
    for (const [, typeConfigs] of Object.entries(this.configs)) {
      if (!typeConfigs) continue;
      mcpNames.push(...Object.keys(typeConfigs));
    }
    return mcpNames.sort();
  }



  async install(targetMcp?: string): Promise<void> {
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

    // If targetMcp is specified, find and install only that MCP
    if (targetMcp) {
      const found = this.findByName(targetMcp);
      if (!found) {
        console.error(`Error: MCP '${targetMcp}' not found.`);
        console.error('Available MCPs:');
        this.listAvailable().forEach(name => console.error(`  ${name}`));
        process.exit(1);
      }

      const { type, config } = found;
      const generated = this.generateConfig(type, config);

      // Check for missing environment variables
      const configJson = JSON.stringify(generated);
      const missingVars = await this.checkMissingEnvVars(configJson);
      if (missingVars.length > 0) {
        console.error(`Error: Missing required environment variables for '${targetMcp}':`);
        missingVars.forEach(varName => console.error(`  ${varName}`));
        process.exit(1);
      }

      try {
        const processedConfig = await this.processConfig(type, config);
        claudeConfig.mcpServers[targetMcp] = processedConfig;
        console.log(`Configured MCP server: ${targetMcp}`);
      } catch (error) {
        console.error(`Failed to process MCP server '${targetMcp}':`, error);
        process.exit(1);
      }
    } else {
      // Process all configs (existing behavior)
      const newServers: Record<string, ServerConfig> = {};

      for (const [type, typeConfigs] of Object.entries(this.configs)) {
        if (!typeConfigs) continue;

        for (const [name, config] of Object.entries(typeConfigs)) {
          const generated = this.generateConfig(type, config as AnyConfig);

          // Check for missing environment variables for all types
          const configJson = JSON.stringify(generated);
          const missingVars = await this.checkMissingEnvVars(configJson);
          if (missingVars.length > 0) {
            console.error(`Error: Missing required environment variables for '${name}':`);
            missingVars.forEach(varName => console.error(`  ${varName}`));
            process.exit(1);
          }

          try {
            newServers[name] = await this.processConfig(type, config as AnyConfig);
            console.log(`Configured MCP server: ${name}`);
          } catch (error) {
            console.error(`Failed to process MCP server '${name}':`, error);
            process.exit(1);
          }
        }
      }

      // Update the config with new servers
      claudeConfig.mcpServers = newServers;
    }

    // Write back to file
    console.time(TIMER_WRITE_CONFIG);
    await writeFile(claudeConfigPath, JSON.stringify(claudeConfig, null, 2));
    console.timeEnd(TIMER_WRITE_CONFIG);
  }
}

export async function install(argv: { mcp?: string; print?: boolean }): Promise<void> {
  try {
    const installer = new Installer();
    await installer.init();

    if (argv.print) {
      await installer.printConfig();
    } else {
      await installer.install(argv.mcp);
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Keep backward compatibility for direct execution
async function main() {
  const args = await yargs(hideBin(process.argv))
    .command('$0 [mcp]', 'Install MCP servers', (yargs) => {
      return yargs
        .positional('mcp', {
          describe: 'Name of specific MCP to install (installs all if not specified)',
          type: 'string'
        })
        .option('print', {
          type: 'boolean',
          description: 'Print MCP configuration as JSON (compatible with Claude Desktop)',
          default: false
        });
    })
    .help()
    .parseAsync();

  await install({ mcp: args.mcp as string | undefined, print: args.print as boolean });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
