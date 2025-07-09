#!/usr/bin/env npx tsx

import { readFile, writeFile, access } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execa } from 'execa';
import { homedir } from 'os';

import {
  Configs,
  ServerConfig,
  ClaudeDesktopConfig,
  Runner,
  createServerConfig,
  preprocessRunner
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

  constructor() {
    this.configPath = join(__dirname, 'mcps.json');
    this.composeFile = join(__dirname, 'docker-compose.yml');
    this.configs = { servers: {} };
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
    if (!this.configs.servers) {
      throw new Error('Invalid MCP configuration: missing servers object');
    }
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
    return createServerConfig(processedRunner);
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
      const runner = this.findByName(targetMcp);
      if (!runner) {
        console.error(`Error: MCP '${targetMcp}' not found.`);
        console.error('Available MCPs:');
        this.listAvailable().forEach(name => console.error(`  ${name}`));
        process.exit(1);
      }

      const generated = this.generateConfig(runner);

      // Check for missing environment variables
      const configJson = JSON.stringify(generated);
      const missingVars = await this.checkMissingEnvVars(configJson);
      if (missingVars.length > 0) {
        console.error(`Error: Missing required environment variables for '${targetMcp}':`);
        missingVars.forEach(varName => console.error(`  ${varName}`));
        process.exit(1);
      }

      try {
        const processedConfig = await this.processConfig(targetMcp, runner);
        claudeConfig.mcpServers[targetMcp] = processedConfig;
        console.log(`Configured MCP server: ${targetMcp}`);
      } catch (error) {
        console.error(`Failed to process MCP server '${targetMcp}':`, error);
        process.exit(1);
      }
    } else {
      // Process all configs (existing behavior)
      const newServers: Record<string, ServerConfig> = {};

      for (const [name, server] of Object.entries(this.configs.servers)) {
        if (!server || !server.runner) continue;

        const generated = this.generateConfig(server.runner);

        // Check for missing environment variables for all types
        const configJson = JSON.stringify(generated);
        const missingVars = await this.checkMissingEnvVars(configJson);
        if (missingVars.length > 0) {
          console.error(`Error: Missing required environment variables for '${name}':`);
          missingVars.forEach(varName => console.error(`  ${varName}`));
          process.exit(1);
        }

        try {
          newServers[name] = await this.processConfig(name, server.runner);
          console.log(`Configured MCP server: ${name}`);
        } catch (error) {
          console.error(`Failed to process MCP server '${name}':`, error);
          process.exit(1);
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
