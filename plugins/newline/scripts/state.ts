import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

type StateStore = Record<string, string>;

function getStateFilePath(): string {
  return process.env.CLAUDE_NEWLINE_STATE_FILE ?? join(tmpdir(), "claude-newline-state.json");
}

async function readStore(): Promise<StateStore> {
  const file = Bun.file(getStateFilePath());
  if (!(await file.exists())) {
    return {};
  }
  try {
    return (await file.json()) as StateStore;
  } catch {
    return {};
  }
}

async function writeStore(store: StateStore): Promise<void> {
  await Bun.write(getStateFilePath(), JSON.stringify(store));
}

function makeKey(type: string, filePath: string): string {
  const hash = createHash("sha256").update(filePath).digest("hex");
  return `${type}:${hash}`;
}

export async function getState(type: string, filePath: string): Promise<string> {
  const store = await readStore();
  return store[makeKey(type, filePath)] ?? "";
}

export async function setState(type: string, filePath: string, value: string): Promise<void> {
  const store = await readStore();
  store[makeKey(type, filePath)] = value;
  await writeStore(store);
}

export async function clearState(type: string, filePath: string): Promise<void> {
  const store = await readStore();
  delete store[makeKey(type, filePath)];
  await writeStore(store);
}

export async function clearAllState(): Promise<void> {
  const file = Bun.file(getStateFilePath());
  if (await file.exists()) {
    await file.delete();
  }
}
