// concurrent dispatches append to one ledger, so writes need O_APPEND atomicity. Bun.write read-modify-write would drop lines.
// oxlint-disable-next-line no-restricted-imports
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

// Only dispatch writes the first two; `outcome` records how a thread came back.
export const CLOSING = ["done", "blocked", "abandoned"] as const;
export type Closing = (typeof CLOSING)[number];
export const OUTCOMES = ["dispatched", "orphaned", ...CLOSING] as const;
export type Outcome = (typeof OUTCOMES)[number];

// A thread stays on the board while someone still owes it a result.
export const OPEN: ReadonlySet<Outcome> = new Set(["dispatched", "blocked"]);

// Nothing prunes an append-only ledger, so caller-supplied text is bounded and
// an oversized value is refused rather than trimmed.
export const MAX_NOTE = 500;

const TAG_KEY = /^[a-z][a-z0-9_-]*$/;
// A tag is a routing key that has to fit a filter argument and a table column.
// The count is capped too, because per-value limits alone leave the row
// unbounded and routing needs a handful of keys rather than an open map.
export const MAX_TAG_VALUE = 200;
export const MAX_TAGS = 8;

// One line per dispatch, written as soon as the worktree exists, so a later
// session can see what was handed out and to which agent. A dispatch that
// failed after that point leaves a checkout nobody owns, which is the case
// cleanup most needs, so `orphaned` rows carry the path with a null agent.
// Later rows for the same repo and branch carry the thread's outcome, and the
// latest row is its state.
export const LedgerRow = z.object({
  ts: z.string(),
  task: z.string(),
  repo: z.string(),
  branch: z.string(),
  path: z.string(),
  workspace: z.string(),
  pane: z.string(),
  agent: z.string().nullable(),
  session: z.string().nullable(),
  outcome: z.enum(OUTCOMES),
  tags: z.record(z.string(), z.string()).optional(),
  pr: z.string().optional(),
  note: z.string().optional(),
});
export type DispatchLedgerRow = z.infer<typeof LedgerRow>;

// A cached plugin's imports stay inside its own directory, so each plugin
// resolves its own data dir.
export function resolveDataDir(override?: string): string {
  if (override != null && override !== "") return override;
  if (process.env.CLAUDE_PLUGIN_DATA != null && process.env.CLAUDE_PLUGIN_DATA !== "")
    return process.env.CLAUDE_PLUGIN_DATA;
  return join(homedir(), ".claude", "plugins", "data", "projects-bendrucker");
}

export function ledgerPath(dataDir: string): string {
  return join(dataDir, "dispatches.jsonl");
}

export function appendDispatch(row: DispatchLedgerRow, dataDir: string): void {
  mkdirSync(dataDir, { recursive: true });
  appendFileSync(ledgerPath(dataDir), `${JSON.stringify(row)}\n`);
}

// The key is constrained so a tag can be a filter argument and a column header without escaping.
export function parseTags(values: readonly string[]): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const value of values) {
    const at = value.indexOf("=");
    const key = at === -1 ? value : value.slice(0, at);
    if (at === -1 || !TAG_KEY.test(key) || value.length === at + 1)
      throw new Error(`tag "${value}" must be <key>=<value> with a key matching ${TAG_KEY}`);
    if (value.length - at - 1 > MAX_TAG_VALUE)
      throw new Error(`tag "${key}" takes a value of at most ${MAX_TAG_VALUE} characters`);
    tags[key] = value.slice(at + 1);
  }
  if (Object.keys(tags).length > MAX_TAGS)
    throw new Error(`at most ${MAX_TAGS} tags, given ${Object.keys(tags).length}`);
  return tags;
}

export function formatTags(tags: Record<string, string> | undefined): string {
  return Object.entries(tags ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
}

// A line that fails to parse is reported and skipped rather than failing the
// read: the ledger is reprinted at every compaction, and one bad line must not
// hide every good one.
export async function readLedger(
  dataDir: string,
  warn: (message: string) => void = (message) => process.stderr.write(`${message}\n`),
): Promise<DispatchLedgerRow[]> {
  const file = Bun.file(ledgerPath(dataDir));
  if (!(await file.exists())) return [];
  const rows: DispatchLedgerRow[] = [];
  const lines = (await file.text()).split("\n");
  for (const [index, line] of lines.entries()) {
    if (line.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      warn(`${ledgerPath(dataDir)}:${index + 1}: not JSON, skipped`);
      continue;
    }
    const result = LedgerRow.safeParse(parsed);
    if (result.success) rows.push(result.data);
    else {
      const issues = result.error.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`,
      );
      warn(`${ledgerPath(dataDir)}:${index + 1}: ${issues.join("; ")}, skipped`);
    }
  }
  return rows;
}

function threadKey(row: Pick<DispatchLedgerRow, "repo" | "branch">): string {
  return `${row.repo}\0${row.branch}`;
}

// The latest row per thread, in the order the threads first appeared.
export function latestRows(rows: readonly DispatchLedgerRow[]): DispatchLedgerRow[] {
  const latest = new Map<string, DispatchLedgerRow>();
  for (const row of rows) latest.set(threadKey(row), row);
  return [...latest.values()];
}

export function hasTags(row: DispatchLedgerRow, tags: Record<string, string>): boolean {
  return Object.entries(tags).every(([key, value]) => row.tags?.[key] === value);
}

export function openThreads(
  rows: readonly DispatchLedgerRow[],
  tags: Record<string, string> = {},
): DispatchLedgerRow[] {
  return latestRows(rows).filter((row) => OPEN.has(row.outcome) && hasTags(row, tags));
}

export interface OutcomeInput {
  repo: string;
  branch: string;
  state: Closing;
  pr?: string | undefined;
  note?: string | undefined;
}

// The outcome row copies the thread's identifiers from its latest row, so
// every row stands alone and folding is a pass over one file. The note
// explains one state, so it does not carry over to the next.
export async function appendOutcome(
  input: OutcomeInput,
  dataDir: string,
  now: () => Date = () => new Date(),
): Promise<DispatchLedgerRow> {
  const key = threadKey(input);
  const latest = latestRows(await readLedger(dataDir)).find((row) => threadKey(row) === key);
  if (latest == null)
    throw new Error(`no dispatch of ${input.branch} in ${input.repo} in ${ledgerPath(dataDir)}`);
  const { note: _previous, ...carried } = latest;
  const row: DispatchLedgerRow = { ...carried, ts: now().toISOString(), outcome: input.state };
  if (input.note != null && input.note.length > MAX_NOTE)
    throw new Error(`--note takes at most ${MAX_NOTE} characters, given ${input.note.length}`);
  if (input.pr != null) row.pr = input.pr;
  if (input.note != null) row.note = input.note;
  appendDispatch(row, dataDir);
  return row;
}
