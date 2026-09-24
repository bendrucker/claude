#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
mkdir -p src
cat > package.json <<'JSON'
{ "name": "worker", "type": "module", "scripts": { "start": "bun src/main.ts" } }
JSON
cat > src/log.ts <<'TS'
const levels = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof levels;

const threshold = levels[process.env.LOG_LEVEL as Level] ?? levels.info;

function emit(level: Level, message: string): void {
  if (levels[level] >= threshold) console.log(`[${level}] ${message}`);
}

export const log = {
  debug: (m: string) => emit("debug", m),
  info: (m: string) => emit("info", m),
  warn: (m: string) => emit("warn", m),
  error: (m: string) => emit("error", m),
};
TS
cat > src/main.ts <<'TS'
import { log } from "./log";

log.debug("loading jobs");
log.info("worker started");
log.debug("polling queue");
TS
cat > .env.example <<'ENV'
LOG_LEVEL=DEBUG
ENV
git add -A && git commit -qm "worker: leveled logging"
