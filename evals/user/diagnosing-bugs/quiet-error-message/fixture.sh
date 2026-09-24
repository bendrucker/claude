#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
mkdir -p src
cat > package.json <<'JSON'
{ "name": "deployer", "type": "module", "scripts": { "deploy": "bun src/deploy.ts" } }
JSON
cat > src/config.ts <<'TS'
import { homedir } from "node:os";
import { join } from "node:path";

export const configPath = process.env.DEPLOYER_CONFIG ?? join(homedir(), ".config/deployer/config.json");

export async function readConfig(): Promise<{ target: string }> {
  const file = Bun.file(configPath);
  if (!(await file.exists())) throw new Error("config not found");
  return file.json();
}
TS
cat > src/deploy.ts <<'TS'
import { readConfig } from "./config";

const { target } = await readConfig();
console.log(`deploying to ${target}`);
TS
git add -A && git commit -qm "deployer: read target from config"
