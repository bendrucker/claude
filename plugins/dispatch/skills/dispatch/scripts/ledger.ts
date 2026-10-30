// concurrent dispatches append to one ledger, so writes need O_APPEND atomicity. Bun.write read-modify-write would drop lines.
// oxlint-disable-next-line no-restricted-imports
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// One line per dispatch, written as soon as the worktree exists, so a later
// session can see what was handed out and to which session. A dispatch that
// failed after that point leaves a checkout nobody owns, which is the case
// cleanup most needs, so `orphaned` rows carry the path with a null target.
export interface DispatchLedgerRow {
  ts: string;
  task: string;
  repo: string;
  branch: string;
  path: string | null;
  mux: "rex" | "herdr" | "bg";
  target: string | null;
  host: string | null;
  name: string;
  session: string | null;
  outcome: "dispatched" | "orphaned";
}

// A cached plugin resolves no import across a plugin boundary, so each plugin
// resolves its own data dir.
export function resolveDataDir(override?: string): string {
  if (override != null && override !== "") return override;
  if (process.env.CLAUDE_PLUGIN_DATA != null && process.env.CLAUDE_PLUGIN_DATA !== "")
    return process.env.CLAUDE_PLUGIN_DATA;
  return join(homedir(), ".claude", "plugins", "data", "dispatch-bendrucker");
}

export function ledgerPath(dataDir: string): string {
  return join(dataDir, "dispatches.jsonl");
}

export function appendDispatch(row: DispatchLedgerRow, dataDir: string): void {
  mkdirSync(dataDir, { recursive: true });
  appendFileSync(ledgerPath(dataDir), `${JSON.stringify(row)}\n`);
}
