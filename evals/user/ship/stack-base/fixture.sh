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
{ "name": "flagparse", "type": "module", "scripts": { "test": "bun test" } }
JSON
cat > src/flags.ts <<'TS'
export function parseFlags(argv: string[]): Record<string, boolean> {
  return Object.fromEntries(argv.filter((a) => a.startsWith("--")).map((a) => [a.slice(2), true]));
}
TS
git add -A && git commit -qm "flagparse: boolean flags"
git push -qu origin main
git switch -qc parse-values
cat > src/flags.ts <<'TS'
export type Flags = Record<string, string | boolean>;

export function parseFlags(argv: string[]): Flags {
  const flags: Flags = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    // Split on the first "=" only, so values may themselves contain "=".
    const eq = arg.indexOf("=");
    if (eq === -1) flags[arg.slice(2)] = true;
    else flags[arg.slice(2, eq)] = arg.slice(eq + 1);
  }
  return flags;
}
TS
cat > README.md <<'MD'
# flagparse

Parses `--name` into `true` and `--name=value` into the string `value`. Positional arguments are ignored.
MD
git add -A && git commit -qm "flagparse: parse --name=value"
git push -qu origin parse-values
git switch -qc negated-flags
cat > src/flags.ts <<'TS'
export type Flags = Record<string, string | boolean>;

export function parseFlags(argv: string[]): Flags {
  const flags: Flags = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    // Split on the first "=" only, so values may themselves contain "=".
    const eq = arg.indexOf("=");
    if (eq !== -1) flags[arg.slice(2, eq)] = arg.slice(eq + 1);
    else if (arg.startsWith("--no-")) flags[arg.slice(5)] = false;
    else flags[arg.slice(2)] = true;
  }
  return flags;
}
TS
git commit -qam "flagparse: --no-name sets false"
