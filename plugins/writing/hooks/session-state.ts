import { tmpdir } from "node:os";
import { join } from "node:path";

// Session-scoped repeat suppression: a context-tier rule that already fired
// recently in this session gets muted instead of re-injected. The state is one
// small JSON file per session in the OS temp dir, so it disappears with the
// machine's temp cleanup and needs no explicit lifecycle.
export const SUPPRESS_WINDOW_MS = 5 * 60 * 1000;

export type SessionState = Record<string, number>;

function statePath(sessionId: string): string {
  const safe = sessionId.replace(/[^\w-]/g, "");
  return join(process.env.TMPDIR ?? tmpdir(), `writing-hooks-${safe}.json`);
}

async function readState(sessionId: string): Promise<SessionState> {
  try {
    const file = Bun.file(statePath(sessionId));
    if (!(await file.exists())) return {};
    const parsed: unknown = await file.json();
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as SessionState;
  } catch {
    return {};
  }
}

export async function recentlyFired(
  sessionId: string,
  category: string,
  now: number,
): Promise<boolean> {
  const state = await readState(sessionId);
  const last = state[category];
  return typeof last === "number" && now - last < SUPPRESS_WINDOW_MS;
}

export async function recordFired(sessionId: string, category: string, now: number): Promise<void> {
  try {
    const state = await readState(sessionId);
    state[category] = now;
    await Bun.write(statePath(sessionId), JSON.stringify(state));
  } catch {
    // State is an optimization. A failed write must not break the hook.
  }
}
