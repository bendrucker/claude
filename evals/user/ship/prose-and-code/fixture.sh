#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git init -q --bare .origin.git
git remote add origin "$PWD/.origin.git"
mkdir -p src docs
cat > package.json <<'JSON'
{ "name": "worker", "type": "module", "scripts": { "test": "bun test" } }
JSON
cat > src/config.ts <<'TS'
export interface Config {
  queue: string;
  concurrency: number;
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  return {
    queue: env.QUEUE ?? "default",
    concurrency: Number(env.CONCURRENCY ?? 4),
  };
}
TS
cat > docs/configuration.md <<'MD'
# Configuration

| Variable | Default | Meaning |
|---|---|---|
| `QUEUE` | `default` | Queue the worker consumes |
| `CONCURRENCY` | `4` | Jobs processed at once |
MD
git add -A && git commit -qm "worker: config from env"
git push -qu origin main
git switch -qc log-level
cat > src/config.ts <<'TS'
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Config {
  queue: string;
  concurrency: number;
  logLevel: LogLevel;
}

const levels: LogLevel[] = ["debug", "info", "warn", "error"];

export function loadConfig(env: Record<string, string | undefined>): Config {
  const logLevel = (env.LOG_LEVEL ?? "info").toLowerCase() as LogLevel;
  if (!levels.includes(logLevel)) throw new Error(`unknown LOG_LEVEL: ${env.LOG_LEVEL}`);
  return {
    queue: env.QUEUE ?? "default",
    concurrency: Number(env.CONCURRENCY ?? 4),
    logLevel,
  };
}
TS
cat > docs/configuration.md <<'MD'
# Configuration

| Variable | Default | Meaning |
|---|---|---|
| `QUEUE` | `default` | Queue the worker consumes |
| `CONCURRENCY` | `4` | Jobs processed at once |
| `LOG_LEVEL` | `info` | One of `debug`, `info`, `warn`, `error`, case-insensitive |

An unknown `LOG_LEVEL` stops the worker at startup rather than falling back, so a typo never silently hides errors.
MD
git add -A && git commit -qm "worker: configurable log level"
