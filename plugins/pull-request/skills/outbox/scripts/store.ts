import { mkdir } from "node:fs/promises";
import { join } from "node:path";

// Outbox dedup state: the URLs this session has already dispatched a babysit
// watcher for. babysit is session-scoped and keeps no shared run-state, so the
// feed tracks its own dispatches to avoid double-watching a PR it is already
// shepherding. State persists in the data dir across sessions.
export interface OutboxState {
  dispatched: string[];
}

function resolveDataDir(dataDir?: string): string {
  const base = dataDir ?? process.env.CLAUDE_PLUGIN_DATA;
  if (!base) {
    throw new Error("dataDir is required (or set CLAUDE_PLUGIN_DATA)");
  }
  return base;
}

function statePath(dataDir?: string): string {
  return join(resolveDataDir(dataDir), "pull-request-outbox", "state.json");
}

export async function readDispatched(dataDir?: string): Promise<Set<string>> {
  const file = Bun.file(statePath(dataDir));
  if (!(await file.exists())) return new Set();
  const data = (await file.json()) as Partial<OutboxState>;
  return new Set(Array.isArray(data.dispatched) ? data.dispatched : []);
}

async function write(dispatched: Set<string>, dataDir?: string): Promise<void> {
  const path = statePath(dataDir);
  await mkdir(join(path, ".."), { recursive: true });
  await Bun.write(path, JSON.stringify({ dispatched: [...dispatched] } satisfies OutboxState));
}

export async function markDispatched(url: string, dataDir?: string): Promise<void> {
  const dispatched = await readDispatched(dataDir);
  dispatched.add(url);
  await write(dispatched, dataDir);
}

export async function resetDispatched(dataDir?: string): Promise<void> {
  await write(new Set(), dataDir);
}
