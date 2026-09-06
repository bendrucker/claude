import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

// Inbox dedup state: the reviews this inbox has already dispatched a background
// session for. Dispatch is fire-and-forget (each review lives in `claude
// agents`, not here), so the inbox tracks its own dispatches to avoid launching
// a second session for a PR it is already reviewing. State persists in the data
// dir across sessions.
export const Dispatch = z.object({
  url: z.string(),
  sessionId: z.string().nullable(),
  dispatchedAt: z.string(),
});
export type Dispatch = z.infer<typeof Dispatch>;

export const InboxState = z.object({ dispatched: z.array(Dispatch) });
export type InboxState = z.infer<typeof InboxState>;

// The pre-background inbox stored { reviews: [...] } of tmux-pane records. Those
// carry no meaning for the dispatch launcher, so an old file migrates to an empty
// dedup set rather than hard-erroring every caller on it.
const LegacyState = z.object({ reviews: z.array(z.unknown()) });

function resolveDataDir(dataDir?: string): string {
  const base = dataDir ?? process.env.CLAUDE_PLUGIN_DATA;
  if (base == null || base === "") {
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
  } catch (error) {
    throw new Error(`Failed to parse state file: ${file.name}`, { cause: error });
  }
  const state = InboxState.safeParse(data);
  if (state.success) return state.data;
  if (LegacyState.safeParse(data).success) return { dispatched: [] };
  throw new Error(`Invalid state file: ${file.name}`);
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
