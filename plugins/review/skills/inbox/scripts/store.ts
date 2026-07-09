import { mkdir } from "node:fs/promises";
import { join } from "node:path";

// Inbox dedup state: the reviews this inbox has already dispatched a background
// session for. Dispatch is fire-and-forget (each review lives in `claude
// agents`, not here), so the inbox tracks its own dispatches to avoid launching
// a second session for a PR it is already reviewing. State persists in the data
// dir across sessions.
export interface Dispatch {
  url: string;
  sessionId: string | null;
  dispatchedAt: string;
}

export interface InboxState {
  dispatched: Dispatch[];
}

function resolveDataDir(dataDir?: string): string {
  const base = dataDir ?? process.env.CLAUDE_PLUGIN_DATA;
  if (!base) {
    throw new Error("dataDir is required (or set CLAUDE_PLUGIN_DATA)");
  }
  return base;
}

function stateDir(dataDir?: string): string {
  return join(resolveDataDir(dataDir), "review-inbox");
}

function statePath(dataDir?: string): string {
  return join(stateDir(dataDir), "state.json");
}

export async function readState(dataDir?: string): Promise<InboxState> {
  const file = Bun.file(statePath(dataDir));
  if (!(await file.exists())) {
    return { dispatched: [] };
  }
  let data: unknown;
  try {
    data = await file.json();
  } catch (cause) {
    throw new Error(`Failed to parse state file: ${file.name}`, { cause });
  }
  if (!data || typeof data !== "object" || !Array.isArray((data as InboxState).dispatched)) {
    throw new Error(`Invalid state file: ${file.name}`);
  }
  return data as InboxState;
}

export function isDispatched(state: InboxState, url: string): boolean {
  return state.dispatched.some((d) => d.url === url);
}

export function addDispatch(state: InboxState, dispatch: Dispatch): void {
  if (isDispatched(state, dispatch.url)) {
    throw new Error(`Review already dispatched: ${dispatch.url}`);
  }
  state.dispatched.push(dispatch);
}

export function removeDispatch(state: InboxState, url: string): number {
  const before = state.dispatched.length;
  state.dispatched = state.dispatched.filter((d) => d.url !== url);
  return before - state.dispatched.length;
}

export async function writeState(state: InboxState, dataDir?: string): Promise<void> {
  await mkdir(stateDir(dataDir), { recursive: true });
  await Bun.write(statePath(dataDir), JSON.stringify(state, null, 2));
}
