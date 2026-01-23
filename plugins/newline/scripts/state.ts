import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

type StateStore = Record<string, string>;

function getStateFilePath(): string {
  return join(tmpdir(), "claude-newline-state.json");
}

function readStore(): StateStore {
  const path = getStateFilePath();
  if (!existsSync(path)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as StateStore;
  } catch {
    return {};
  }
}

function writeStore(store: StateStore): void {
  writeFileSync(getStateFilePath(), JSON.stringify(store));
}

function makeKey(type: string, filePath: string): string {
  const hash = createHash("sha256").update(filePath).digest("hex");
  return `${type}:${hash}`;
}

export function getState(type: string, filePath: string): string {
  const store = readStore();
  return store[makeKey(type, filePath)] ?? "";
}

export function setState(type: string, filePath: string, value: string): void {
  const store = readStore();
  store[makeKey(type, filePath)] = value;
  writeStore(store);
}

export function clearState(type: string, filePath: string): void {
  const store = readStore();
  delete store[makeKey(type, filePath)];
  writeStore(store);
}

export function clearAllState(): void {
  const path = getStateFilePath();
  if (existsSync(path)) {
    unlinkSync(path);
  }
}
