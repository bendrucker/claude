#!/usr/bin/env npx tsx

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { execa } from 'execa';
import { homedir } from 'os';

import {
  Configs,
  ServerConfig,
  ClaudeDesktopConfig,
  Runner,
  createServerConfig,
  preprocessRunner,
  loadDir
} from '../lib/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Timer constants
const TIMER_LOAD_CONFIG = 'Load ~/.claude.json';
const TIMER_WRITE_CONFIG = 'Write ~/.claude.json';

// Helper functions
function getConfigPath(app: string): string {
  switch (app) {
    case 'claude-code':
      return join(homedir(), '.claude.json');
    case 'claude-desktop':
      return join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
    default:
      throw new Error(`Unsupported app: ${app}`);
  }
}

function validateApps(apps: string[]): void {
  const validApps = ['claude-code', 'claude-desktop'];
  for (const app of apps) {
    if (!validApps.includes(app)) {
      throw new Error(`Unsupported app: ${app}. Valid apps: ${validApps.join(', ')}`);
    }
  }
}

class Installer {
  private directory: string;
  private configPath: string;
  private composeFile: string;
  private configs: Configs;
  private dockerComposeEnvs: Record<string, Record<string, string>> = {};

  constructor(directory: string) {
    this.directory = resolve(directory);
    this.configPath = join(this.directory, 'mcps.json');
    this.composeFile = join(this.directory, 'docker-compose.yml');
    this.configs = { servers: {} };
  }


  async init(): Promise<void> {
    this.configs = await loadDir(this.directory);
    
    // Validate configuration structure
    for (const [name, server] of Object.entries(this.configs.servers)) {
      if (!server || !server.runner || !server.targets) {
        throw new Error(`Invalid MCP configuration for '${name}': missing runner or targets`);
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
    const dockerServices = new Set<string>();
    for (const server of Object.values(this.configs.servers)) {
      if (server.runner && 'docker' in server.runner) {
        dockerServices.add(server.runner.docker.service);
      }
    }

    if (dockerServices.size === 0) return;

    try {
      // Load docker-compose config once
      const { stdout: configJson } = await execa('docker', ['compose', '--file', this.composeFile, 'config', '--format', 'json']);
      const composeConfig = JSON.parse(configJson);

      // Extract environment for each service
      for (const serviceName of dockerServices) {
        this.dockerComposeEnvs[serviceName] = this.extractServiceEnv(composeConfig, serviceName);
      }
    } catch {
      // If docker-compose config fails, set empty envs for all services
      for (const serviceName of dockerServices) {
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


  private generateConfig(runner: Runner): ServerConfig {
    const processedRunner = preprocessRunner(runner, this.dockerComposeEnvs);
    return createServerConfig(processedRunner, this.directory);
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

  private async processConfig(name: string, runner: Runner): Promise<ServerConfig> {
    const generated = this.generateConfig(runner);
    const configJson = JSON.stringify(generated);

    // Check for missing environment variables for all types
    const missingVars = await this.checkMissingEnvVars(configJson);
    if (missingVars.length > 0) {
      throw new Error(`Missing required environment variables for ${name}: ${missingVars.join(', ')}`);
    }

    // Perform envsubst on all server types
    const interpolated = await this.envsubst(configJson);
    return JSON.parse(interpolated) as ServerConfig;
  }

  async printConfig(): Promise<void> {
    const mcpServers: Record<string, ServerConfig> = {};

    for (const [name, server] of Object.entries(this.configs.servers)) {
      if (!server || !server.runner) continue;

      try {
        mcpServers[name] = await this.processConfig(name, server.runner);
      } catch (error) {
        console.error(`Error processing '${name}':`, error instanceof Error ? error.message : error);
        process.exit(1);
      }
    }

    const desktopConfig: ClaudeDesktopConfig = { mcpServers };
    console.log(JSON.stringify(desktopConfig, null, 2));
  }

  private findByName(name: string): Runner | null {
    const server = this.configs.servers[name];
    return server?.runner || null;
  }

  private listAvailable(): string[] {
    return Object.keys(this.configs.servers).sort();
  }



  async install(targetMcp?: string, apps: string[] = ['claude-code', 'claude-desktop']): Promise<void> {
    validateApps(apps);

    // Process all configs once
    const mcpServers: Record<string, ServerConfig> = {};

    if (targetMcp) {
      const runner = this.findByName(targetMcp);
      if (!runner) {
        console.error(`Error: MCP '${targetMcp}' not found.`);
        console.error('Available MCPs:');
        this.listAvailable().forEach(name => console.error(`  ${name}`));
        process.exit(1);
      }

      try {
        mcpServers[targetMcp] = await this.processConfig(targetMcp, runner);
        console.log(`Configured MCP server: ${targetMcp}`);
      } catch (error) {
        console.error(`Failed to process MCP server '${targetMcp}':`, error);
        process.exit(1);
      }
    } else {
      // Process all configs
      for (const [name, server] of Object.entries(this.configs.servers)) {
        if (!server || !server.runner) continue;

        try {
          mcpServers[name] = await this.processConfig(name, server.runner);
          console.log(`Configured MCP server: ${name}`);
        } catch (error) {
          console.error(`Failed to process MCP server '${name}':`, error);
          process.exit(1);
        }
      }
    }

    // Write to each target app
    for (const app of apps) {
      await this.writeAppConfig(app, mcpServers, targetMcp);
    }
  }

  private async writeAppConfig(app: string, mcpServers: Record<string, ServerConfig>, targetMcp?: string): Promise<void> {
    const configPath = getConfigPath(app);

    // Ensure directory exists
    await mkdir(dirname(configPath), { recursive: true });

    // Load existing config
    console.time(`Load ${app} config`);
    let config: ClaudeDesktopConfig;
    try {
      const content = await readFile(configPath, 'utf-8');
      config = JSON.parse(content);
      console.timeEnd(`Load ${app} config`);
    } catch {
      config = { mcpServers: {} };
      console.timeEnd(`Load ${app} config`);
    }

    // Update config with new servers
    if (targetMcp) {
      config.mcpServers[targetMcp] = mcpServers[targetMcp];
    } else {
      config.mcpServers = mcpServers;
    }

    // Write back to file
    console.time(`Write ${app} config`);
    await writeFile(configPath, JSON.stringify(config, null, 2));
    console.timeEnd(`Write ${app} config`);
    console.log(`Updated ${app} configuration`);
  }
}

interface InstallArgs {
  directory: string;
  mcp?: string;
  print?: boolean;
  app: string[];
}

export async function install(argv: InstallArgs): Promise<void> {
  try {
    const installer = new Installer(argv.directory);
    await installer.init();

    if (argv.print) {
      await installer.printConfig();
    } else {
      await installer.install(argv.mcp, argv.app);
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
