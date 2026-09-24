#!/usr/bin/env bash
set -euo pipefail
mkdir -p src
cat > src/settings.ts <<'TS'
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export interface Settings {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
}

export function openSettings(path: string): Settings {
  const values: Record<string, string> = existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, string>)
    : {};
  const save = () => writeFileSync(path, JSON.stringify(values, null, 2));
  return {
    get: (key) => values[key],
    set(key, value) {
      values[key] = value;
      save();
    },
  };
}
TS
