#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
# The Linux sandbox mounts placeholder dotfiles into the working tree.
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git remote add origin https://github.com/bendrucker/claude-plugins.git
mkdir -p plugins/lint plugins/format legacy
echo '{ "timeout": 30, "verbose": false }' > legacy/config.json
cat > plugins/lint/lint.ts <<'TS'
import { spawnSync } from "node:child_process";

export function lint(options: { timeout: number; verbose?: boolean }): number {
  return spawnSync("oxlint", ["."], { timeout: options.timeout * 1000, stdio: "inherit" }).status ?? 1;
}
TS
cat > plugins/format/format.ts <<'TS'
import { spawnSync } from "node:child_process";

export function format(options: { timeout: number; verbose?: boolean }): number {
  return spawnSync("oxfmt", ["--write", "."], { timeout: options.timeout * 1000, stdio: "inherit" }).status ?? 1;
}
TS
cat > plugins/lint/run.ts <<'TS'
import config from "../../legacy/config.json";
import { lint } from "./lint";
export const run = () => lint({ timeout: config.timeout, verbose: config.verbose });
TS
cat > plugins/format/run.ts <<'TS'
import config from "../../legacy/config.json";
import { format } from "./format";
export const run = () => format({ timeout: config.timeout, verbose: config.verbose });
TS
git add -A && git commit -qm "plugins: add lint and format"
git switch -qc plugin-config
cat > plugins/lint/config.ts <<'TS'
export const config = { timeout: 30 };
TS
cat > plugins/format/config.ts <<'TS'
export const config = { timeout: 30 };
TS
cat > plugins/lint/run.ts <<'TS'
import { config } from "./config";
import { lint } from "./lint";
export const run = () => lint(config);
TS
cat > plugins/format/run.ts <<'TS'
import { config } from "./config";
import { format } from "./format";
export const run = () => format(config);
TS
git add -A && git commit -qm "plugins: give each plugin its own config"
