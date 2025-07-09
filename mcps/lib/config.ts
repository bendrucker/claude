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

export function createServerConfig(runner: Runner): ServerConfig {
  const baseDir = join(__dirname, '..');
  
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
      cwd: baseDir
    };
  }
  
  if ('go' in runner) {
    return {
      type: 'stdio',
      command: 'go',
      args: ['-C', baseDir, 'tool', runner.go.module].concat(runner.go.args || []),
      env: runner.go.env || {},
      cwd: baseDir
    };
  }
  
  if ('uvx' in runner) {
    return {
      type: 'stdio',
      command: 'uvx',
      args: ['--directory', baseDir, runner.uvx.package],
      env: runner.uvx.env || {},
      cwd: baseDir
    };
  }
  
  if ('npm' in runner) {
    return {
      type: 'stdio',
      command: 'npx',
      args: ['--prefix', baseDir, '--no-install', runner.npm.binary || runner.npm.package],
      env: runner.npm.env || {},
      cwd: baseDir
    };
  }
  
  if ('docker' in runner) {
    return {
      type: 'stdio',
      command: 'docker',
      args: ['compose', '--file', join(baseDir, 'docker-compose.yml'), 'run', '--rm', runner.docker.service],
      env: runner.docker.env || {},
      cwd: baseDir
    };
  }
  
  throw new Error('Unknown runner type');
}

