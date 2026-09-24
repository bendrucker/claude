#!/usr/bin/env bash
set -euo pipefail
mkdir -p src
cat > src/save.ts <<'TS'
import { writeFile } from "node:fs/promises";
import { notifyWatchers } from "./watchers";

export async function save(path: string, content: string) {
  await writeFile(path, content);
  const result = { path, bytes: content.length, savedAt: Date.now() };
  notifyWatchers(result);
  return result;
}
TS
cat > src/watchers.ts <<'TS'
const listeners: ((r: { path: string }) => void)[] = [];
export const onSave = (fn: (r: { path: string }) => void) => listeners.push(fn);
export const notifyWatchers = (r: { path: string }) => listeners.forEach((fn) => fn(r));
TS
