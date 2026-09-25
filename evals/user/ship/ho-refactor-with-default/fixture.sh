#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git init -q --bare .origin.git
git remote add origin "$PWD/.origin.git"
mkdir -p src
cat > package.json <<'JSON'
{ "name": "fetcher", "type": "module", "scripts": { "test": "bun test" } }
JSON
cat > src/client.ts <<'TS'
export interface ClientOptions {
  baseUrl: string;
  timeoutMs?: number;
}

export function createClient({ baseUrl, timeoutMs = 30_000 }: ClientOptions) {
  return (path: string) => fetch(new URL(path, baseUrl), { signal: AbortSignal.timeout(timeoutMs) });
}
TS
git add -A && git commit -qm "fetcher: client with timeout"
git push -qu origin main
git switch -qc options-module
cat > src/options.ts <<'TS'
export interface ClientOptions {
  baseUrl: string;
  timeoutMs?: number;
}

export function resolveOptions({ baseUrl, timeoutMs = 10_000 }: ClientOptions): Required<ClientOptions> {
  return { baseUrl, timeoutMs };
}
TS
cat > src/client.ts <<'TS'
import { type ClientOptions, resolveOptions } from "./options";

export function createClient(options: ClientOptions) {
  const { baseUrl, timeoutMs } = resolveOptions(options);
  return (path: string) => fetch(new URL(path, baseUrl), { signal: AbortSignal.timeout(timeoutMs) });
}
TS
git add -A && git commit -qm "fetcher: move option handling into its own module"
