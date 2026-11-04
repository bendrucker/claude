// concurrent dispatches append to one ledger, so writes need O_APPEND atomicity. Bun.write read-modify-write would drop lines.
// oxlint-disable-next-line no-restricted-imports
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

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
  // The name the dispatched session reaches its dispatcher by.
  sender: string | null;
  // `failed` is a dispatch that reused a worktree it did not create.
  outcome: "dispatched" | "orphaned" | "failed";
}

const DispatchRowSchema = z.object({
  ts: z.string(),
  task: z.string(),
  repo: z.string(),
  branch: z.string(),
  path: z.string().nullable(),
  mux: z.enum(["rex", "herdr", "bg"]),
  target: z.string().nullable(),
  host: z.string().nullable(),
  name: z.string(),
  session: z.string().nullable(),
  sender: z.string().nullable(),
  outcome: z.enum(["dispatched", "orphaned", "failed"]),
});

// One line per pane close or per finished background watch, so cleanup can
// find the work a closed session left on disk. `outcome` is set on `ended` rows.
const ClosedRowSchema = z.object({
  event: z.enum(["closed", "ended"]),
  ts: z.string(),
  session: z.string(),
  fork: z.string().nullable(),
  branch: z.string().nullable(),
  path: z.string().nullable(),
  head: z.string().nullable(),
  dirty: z.number().nullable(),
  ahead: z.number().nullable(),
  pr: z.string().nullable(),
  mux: z.enum(["rex", "herdr"]).nullable(),
  target: z.string().nullable(),
  summary: z.string().nullable(),
  outcome: z.enum(["merged", "closed", "stopped"]).optional(),
});

export type ClosedRow = z.infer<typeof ClosedRowSchema>;

export type LedgerRow = DispatchLedgerRow | ClosedRow;

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

export function appendDispatch(row: LedgerRow, dataDir: string): void {
  mkdirSync(dataDir, { recursive: true });
  appendFileSync(ledgerPath(dataDir), `${JSON.stringify(row)}\n`);
}

export function parseLedgerLine(line: string): LedgerRow | null {
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    // A torn or foreign line is skipped so the rest of the ledger still reads.
    return null;
  }
  const schema =
    typeof json === "object" && json !== null && "event" in json
      ? ClosedRowSchema
      : DispatchRowSchema;
  const parsed = schema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

export function readLedger(dataDir: string): LedgerRow[] {
  const file = ledgerPath(dataDir);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .flatMap((line) => parseLedgerLine(line) ?? []);
}

export function isClosedRow(row: LedgerRow): row is ClosedRow {
  return "event" in row;
}
