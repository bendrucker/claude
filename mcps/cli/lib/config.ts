import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFile } from 'fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface EnvConfig {
  env?: Record<string, string>;
}

export interface HttpConfig {
  url: string;
  headers?: Record<string, string>;
}

export interface BinaryConfig extends EnvConfig {
  command: string;
  args?: string[];
}

export interface GoConfig extends EnvConfig {
  module: string;
  args?: string[];
}

export interface UvxConfig extends EnvConfig {
  package: string;
  binary?: string;
}

export interface NpmConfig extends EnvConfig {
  package: string;
  binary?: string;
}

export interface DockerConfig extends EnvConfig {
  service: string;
}

export interface HttpRunner {
  http: HttpConfig;
}

export interface BinaryRunner {
  binary: BinaryConfig;
}

export interface GoRunner {
  go: GoConfig;
}

export interface UvxRunner {
  uvx: UvxConfig;
}

export interface NpmRunner {
  npm: NpmConfig;
}

export interface DockerRunner {
  docker: DockerConfig;
}

export type Runner = HttpRunner | BinaryRunner | GoRunner | UvxRunner | NpmRunner | DockerRunner;

export interface TargetLabels {
  language?: string[];
  type?: string[];
}

export interface Targets {
  scope: 'user' | 'project';
  labels?: TargetLabels;
}

export interface McpServer {
  runner: Runner;
  targets: Targets;
}


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
  servers: Record<string, McpServer>;
}

export interface ClaudeDesktopConfig {
  mcpServers: Record<string, ServerConfig>;
}

// Pre-process runner by merging Docker Compose environment if needed
export function preprocessRunner(
  runner: Runner,
  dockerComposeEnvs: Record<string, Record<string, string>> = {}
): Runner {
  if ('docker' in runner) {
    const composeEnv = dockerComposeEnvs[runner.docker.service] || {};
    const mergedEnv = { ...composeEnv, ...runner.docker.env };
    return {
      docker: {
        ...runner.docker,
        env: mergedEnv
      }
    };
  }
  return runner;
}

export function createServerConfig(runner: Runner, directory: string): ServerConfig {
  
  if ('http' in runner) {
    return {
      type: 'http',
      url: runner.http.url,
      ...(runner.http.headers && { headers: runner.http.headers })
    };
  }
  
  if ('binary' in runner) {
    return {
      type: 'stdio',
      command: runner.binary.command,
      args: runner.binary.args,
      env: runner.binary.env || {},
      cwd: directory
    };
  }
  
  if ('go' in runner) {
    return {
      type: 'stdio',
      command: 'go',
      args: ['-C', directory, 'tool', runner.go.module].concat(runner.go.args || []),
      env: runner.go.env || {},
      cwd: directory
    };
  }
  
  if ('uvx' in runner) {
    const args = ['--directory', directory];
    if (runner.uvx.binary) {
      args.push('--from', runner.uvx.package, runner.uvx.binary);
    } else {
      args.push(runner.uvx.package);
    }
    return {
      type: 'stdio',
      command: 'uvx',
      args,
      env: runner.uvx.env || {},
      cwd: directory
    };
  }
  
  if ('npm' in runner) {
    return {
      type: 'stdio',
      command: 'npx',
      args: ['--prefix', directory, runner.npm.binary || runner.npm.package],
      env: runner.npm.env || {},
      cwd: directory
    };
  }
  
  if ('docker' in runner) {
    return {
      type: 'stdio',
      command: 'docker',
      args: ['compose', '--file', join(directory, 'docker-compose.yml'), 'run', '--rm', runner.docker.service],
      env: runner.docker.env || {},
      cwd: directory
    };
  }
  
  throw new Error('Unknown runner type');
}

export async function loadDir(directory: string): Promise<Configs> {
  const configPath = join(directory, 'mcps.json');
  try {
    const configData = await readFile(configPath, 'utf-8');
    const config = JSON.parse(configData);
    
    if (!config.servers) {
      throw new Error('Invalid MCP configuration: missing servers object');
    }
    
    return config;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      throw new Error(`Directory '${directory}' does not contain required mcps.json file`);
    }
    throw error;
  }
}

