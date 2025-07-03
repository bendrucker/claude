import { readFile, access } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execa } from 'execa';

// Types and interfaces
export interface EnvConfig {
  env?: Record<string, string>;
}

export interface HttpConfig {
  url: string;
  headers?: Record<string, string>;
}

export interface GoConfig extends EnvConfig {
  module: string;
}

export interface UvxConfig extends EnvConfig {
  package: string;
}

export interface NpmConfig extends EnvConfig {
  package: string;
  binary?: string;
}

export interface DockerConfig extends EnvConfig {
  service: string;
}

export type AnyMcpConfig = HttpConfig | GoConfig | UvxConfig | NpmConfig | DockerConfig;

export interface McpConfigs {
  http?: { [name: string]: HttpConfig };
  go?: { [name: string]: GoConfig };
  uvx?: { [name: string]: UvxConfig };
  npm?: { [name: string]: NpmConfig };
  docker?: { [name: string]: DockerConfig };
}

export interface McpServerConfig {
  type: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

export interface ClaudeDesktopConfig {
  mcpServers: Record<string, McpServerConfig>;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

export class McpConfigManager {
  private mcpsConfig: string;
  private composeFile: string;
  private configs: McpConfigs;
  private dockerComposeEnvs: Record<string, Record<string, string>> = {};

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
    }),
    docker: (config: DockerConfig): McpServerConfig => {
      const composeEnv = this.dockerComposeEnvs[config.service] || {};
      const mergedEnv = { ...composeEnv, ...config.env };

      return {
        type: 'stdio',
        command: 'docker',
        args: ['compose', '--file', this.composeFile, 'run', '--rm', config.service],
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

  private generate(type: string, config: AnyMcpConfig): McpServerConfig {
    const generator = this.configGenerators[type as keyof typeof this.configGenerators];
    if (!generator) {
      throw new Error(`Unknown MCP type: ${type}`);
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

  async process(type: string, config: AnyMcpConfig): Promise<McpServerConfig> {
    const generated = this.generate(type, config);
    const configJson = JSON.stringify(generated);

    // Check for missing environment variables for all types
    const missingVars = await this.checkMissingEnvVars(configJson);
    if (missingVars.length > 0) {
      throw new Error(`Missing required environment variables for ${type} config: ${missingVars.join(', ')}`);
    }

    // Perform envsubst on all server types
    const interpolated = await this.envsubst(configJson);
    return JSON.parse(interpolated) as McpServerConfig;
  }

  all(): Array<{ name: string; type: string; config: McpServerConfig }> {
    const mcpConfigs: Array<{ name: string; type: string; config: McpServerConfig }> = [];

    for (const [type, typeConfigs] of Object.entries(this.configs)) {
      if (!typeConfigs) continue;

      for (const [name, config] of Object.entries(typeConfigs)) {
        const mcpConfig = this.generate(type, config as AnyMcpConfig);
        mcpConfigs.push({ name, type, config: mcpConfig });
      }
    }

    return mcpConfigs;
  }

  getLocal(): Array<{ name: string; type: string; config: McpServerConfig }> {
    return this.all().filter(({ type }) => type !== 'http');
  }

  find(name: string): { type: string; config: AnyMcpConfig } | null {
    for (const [type, typeConfigs] of Object.entries(this.configs)) {
      if (!typeConfigs) continue;

      if (typeConfigs[name]) {
        return { type, config: typeConfigs[name] as AnyMcpConfig };
      }
    }
    return null;
  }

  list(): string[] {
    const mcpNames: string[] = [];
    for (const [type, typeConfigs] of Object.entries(this.configs)) {
      if (!typeConfigs) continue;
      mcpNames.push(...Object.keys(typeConfigs));
    }
    return mcpNames.sort();
  }

  async generateClaudeDesktopConfig(): Promise<ClaudeDesktopConfig> {
    const mcpServers: Record<string, McpServerConfig> = {};

    for (const [type, typeConfigs] of Object.entries(this.configs)) {
      if (!typeConfigs) continue;

      for (const [name, config] of Object.entries(typeConfigs)) {
        mcpServers[name] = await this.process(type, config as AnyMcpConfig);
      }
    }

    return { mcpServers };
  }
}
