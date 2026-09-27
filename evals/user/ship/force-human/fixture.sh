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
{
  "name": "schema-kit",
  "type": "module",
  "dependencies": { "zod": "^3.22.4" },
  "devDependencies": { "typescript": "^5.4.5" }
}
JSON
cat > src/user.ts <<'TS'
import { z } from "zod";

export const User = z.object({ id: z.string(), email: z.string().email() });
TS
git add -A && git commit -qm "schema-kit: user schema"
git push -qu origin main
git switch -qc bump-deps
cat > package.json <<'JSON'
{
  "name": "schema-kit",
  "type": "module",
  "dependencies": { "zod": "^3.23.8" },
  "devDependencies": { "typescript": "^5.6.3" }
}
JSON
git commit -qam "deps: bump zod and typescript"
