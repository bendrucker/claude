#!/usr/bin/env bash
set -euo pipefail
mkdir -p src
cat > src/slug.ts <<'TS'
export function slugify(title: string, sep = "-"): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, sep)
    .replace(new RegExp(`^${sep}|${sep}$`, "g"), "");
}
TS
