import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

export type AnyConfig = HttpConfig | GoConfig | UvxConfig | NpmConfig | DockerConfig;

export interface ServerConfig {
  type: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
}

export interface Configs {
  http?: { [name: string]: HttpConfig };
  go?: { [name: string]: GoConfig };
  uvx?: { [name: string]: UvxConfig };
  npm?: { [name: string]: NpmConfig };
  docker?: { [name: string]: DockerConfig };
}

export interface ClaudeDesktopConfig {
  mcpServers: Record<string, ServerConfig>;
}

export function createServerConfig(
  type: string, 
  config: AnyConfig,
  dockerComposeEnvs: Record<string, Record<string, string>> = {}
): ServerConfig {
  const baseDir = join(__dirname, '..');
  
  switch (type) {
    case 'http':
      const httpConfig = config as HttpConfig;
      return {
        type: 'http',
        url: httpConfig.url,
        ...(httpConfig.headers && { headers: httpConfig.headers })
      };
    case 'go':
      const goConfig = config as GoConfig;
      return {
        type: 'stdio',
        command: 'go',
        args: ['-C', baseDir, 'tool', goConfig.module],
        env: goConfig.env || {},
        cwd: baseDir
      };
    case 'uvx':
      const uvxConfig = config as UvxConfig;
      return {
        type: 'stdio',
        command: 'uvx',
        args: ['--directory', baseDir, uvxConfig.package],
        env: uvxConfig.env || {},
        cwd: baseDir
      };
    case 'npm':
      const npmConfig = config as NpmConfig;
      return {
        type: 'stdio',
        command: 'npx',
        args: ['--prefix', baseDir, '--no-install', npmConfig.binary || npmConfig.package],
        env: npmConfig.env || {},
        cwd: baseDir
      };
    case 'docker':
      const dockerConfig = config as DockerConfig;
      const composeEnv = dockerComposeEnvs[dockerConfig.service] || {};
      const mergedEnv = { ...composeEnv, ...dockerConfig.env };
      return {
        type: 'stdio',
        command: 'docker',
        args: ['compose', '--file', join(baseDir, 'docker-compose.yml'), 'run', '--rm', dockerConfig.service],
        env: mergedEnv,
        cwd: baseDir
      };
    default:
      throw new Error(`Unknown MCP type: ${type}`);
  }
}