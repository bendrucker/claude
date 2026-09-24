#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
mkdir -p src
cat > package.json <<'JSON'
{ "name": "fetcher", "type": "module", "scripts": { "show-config": "bun src/show.ts" } }
JSON
cat > src/config.ts <<'TS'
export interface Config {
  retries: number;
  timeoutMs: number;
  userAgent: string;
}

export const defaults: Config = { retries: 3, timeoutMs: 5000, userAgent: "fetcher/1.0" };

function fromEnv(): Partial<Config> {
  const env: Partial<Config> = {};
  if (process.env.FETCHER_TIMEOUT_MS) env.timeoutMs = Number(process.env.FETCHER_TIMEOUT_MS);
  return env;
}

export async function loadConfig(path = "config.json"): Promise<Config> {
  const file = Bun.file(path);
  const user: Partial<Config> = (await file.exists()) ? await file.json() : {};
  return { ...user, ...fromEnv(), ...defaults };
}
TS
cat > src/show.ts <<'TS'
import { loadConfig } from "./config";

console.log(JSON.stringify(await loadConfig(), null, 2));
TS
cat > config.json <<'JSON'
{ "retries": 5 }
JSON
git add -A && git commit -qm "fetcher: layered config"
