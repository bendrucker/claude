#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git remote add origin https://github.com/bendrucker/claude-plugins.git
mkdir -p plugins/lint plugins/format legacy
echo '{ "timeout": 30, "verbose": false }' > legacy/config.json
cat > plugins/lint/run.ts <<'TS'
import config from "../../legacy/config.json";
export const run = () => lint({ timeout: config.timeout, verbose: config.verbose });
TS
cat > plugins/format/run.ts <<'TS'
import config from "../../legacy/config.json";
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
export const run = () => lint(config);
TS
cat > plugins/format/run.ts <<'TS'
import { config } from "./config";
export const run = () => format(config);
TS
git add -A && git commit -qm "plugins: give each plugin its own config"
