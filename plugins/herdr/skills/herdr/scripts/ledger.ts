// concurrent dispatches append to one ledger, so writes need O_APPEND atomicity. Bun.write read-modify-write would drop lines.
// oxlint-disable-next-line no-restricted-imports
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// One line per dispatch, so a later session can see what was handed out and to
// which agent. No status: the ledger records the hand-off, not its outcome.
export interface DispatchLedgerRow {
  ts: string;
  task: string;
  repo: string;
  branch: string;
  workspace: string;
  pane: string;
  agent: string | null;
  session: string | null;
}

// A cross-plugin import cannot resolve in a cached plugin, so this mirrors
// plugins/writing/skills/analyze/scripts/data-dir.ts rather than sharing it.
export function resolveDataDir(override?: string): string {
  if (override != null && override !== "") return override;
  if (process.env.CLAUDE_PLUGIN_DATA != null && process.env.CLAUDE_PLUGIN_DATA !== "")
    return process.env.CLAUDE_PLUGIN_DATA;
  return join(homedir(), ".claude", "plugins", "data", "herdr-bendrucker");
}

export function ledgerPath(dataDir: string): string {
  return join(dataDir, "dispatches.jsonl");
}

export function appendDispatch(row: DispatchLedgerRow, dataDir: string): void {
  mkdirSync(dataDir, { recursive: true });
  appendFileSync(ledgerPath(dataDir), `${JSON.stringify(row)}\n`);
}
