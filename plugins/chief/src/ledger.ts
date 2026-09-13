// Ledger appends need O_APPEND atomicity across concurrent writers; Bun.write's
// read-modify-write would drop concurrent lines.
// oxlint-disable-next-line no-restricted-imports
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { nextBoundary, nextDigest, parseDuration } from "./release";
import type { Actor, LedgerRow, Presence } from "./types";

export const LEDGER_PATH = join(homedir(), ".local", "state", "chief", "ledger.jsonl");
const LEGACY_ACTOR: Actor = "manual";

const LedgerRowSchema = z.object({
  id: z.string(),
  key: z.string(),
  ts: z.string(),
  source: z.enum(["claude-hook", "herdr", "phone", "manual"]),
  kind: z.string(),
  title: z.string(),
  session: z.string().optional(),
  pane: z.string().optional(),
  tier: z.enum(["now", "boundary", "digest"]),
  releaseAt: z.string(),
  state: z.enum(["open", "held", "pushed", "acked", "resolved", "dropped"]),
  reason: z.string(),
  actor: z.enum(["phone", "chief", "daemon", "manual"]).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

const STUB_PRESENCE: Presence = {
  focus: null,
  busyUntil: null,
  activeNode: "studio",
  updatedAt: new Date(0).toISOString(),
};
const DEFAULT_WORK_HOURS: [string, string] = ["09:00", "18:00"];

export function append(row: LedgerRow, path: string = LEDGER_PATH): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(row)}\n`);
}

export async function read(path: string = LEDGER_PATH): Promise<Map<string, LedgerRow>> {
  const file = Bun.file(path);
  if (!(await file.exists())) return new Map();

  const latest = new Map<string, LedgerRow>();
  for (const line of (await file.text()).split("\n")) {
    if (line.trim() === "") continue;
    let parsed: z.infer<typeof LedgerRowSchema>;
    try {
      parsed = LedgerRowSchema.parse(JSON.parse(line));
    } catch {
      continue;
    }
    const row: LedgerRow = {
      id: parsed.id,
      key: parsed.key,
      ts: parsed.ts,
      source: parsed.source,
      kind: parsed.kind,
      title: parsed.title,
      tier: parsed.tier,
      releaseAt: parsed.releaseAt,
      state: parsed.state,
      reason: parsed.reason,
      actor: parsed.actor ?? LEGACY_ACTOR,
    };
    if (parsed.session !== undefined) row.session = parsed.session;
    if (parsed.pane !== undefined) row.pane = parsed.pane;
    if (parsed.payload !== undefined) row.payload = parsed.payload;
    latest.set(row.id, row);
  }
  return latest;
}

export async function transition(
  id: string,
  patch: Partial<LedgerRow>,
  path: string = LEDGER_PATH,
  now: Date = new Date(),
): Promise<LedgerRow> {
  const prev = (await read(path)).get(id);
  if (!prev) throw new Error(`no ledger row for id: ${id}`);
  const next: LedgerRow = { ...prev, ...patch, id, ts: now.toISOString() };
  append(next, path);
  return next;
}

export interface HoldInput {
  actor: Actor;
  for?: string | undefined;
  until?: string | undefined;
}

export interface HoldContext {
  now?: Date;
  presence?: Presence;
  workHours?: [string, string];
}

export async function hold(
  id: string,
  input: HoldInput,
  path: string = LEDGER_PATH,
  ctx: HoldContext = {},
): Promise<LedgerRow> {
  const now = ctx.now ?? new Date();
  return transition(
    id,
    { state: "held", releaseAt: holdReleaseAt(input, now, ctx), actor: input.actor },
    path,
    now,
  );
}

export function holdReleaseAt(input: HoldInput, now: Date, ctx: HoldContext): string {
  if (input.for != null && input.for !== "") {
    return new Date(now.getTime() + parseDuration(input.for)).toISOString();
  }
  if (input.until === "boundary") {
    return nextBoundary(now, ctx.presence ?? STUB_PRESENCE).toISOString();
  }
  if (input.until === "digest") {
    return nextDigest(now, { workHours: ctx.workHours ?? DEFAULT_WORK_HOURS }).toISOString();
  }
  if (input.until != null && input.until !== "") return input.until;
  throw new Error("hold requires `for` or `until`");
}

export function drop(
  id: string,
  actor: Actor,
  path: string = LEDGER_PATH,
  now: Date = new Date(),
): Promise<LedgerRow> {
  return transition(id, { state: "dropped", actor }, path, now);
}

export function ack(
  id: string,
  actor: Actor,
  path: string = LEDGER_PATH,
  now: Date = new Date(),
): Promise<LedgerRow> {
  return transition(id, { state: "acked", actor }, path, now);
}

export function resolve(
  id: string,
  actor: Actor,
  path: string = LEDGER_PATH,
  now: Date = new Date(),
): Promise<LedgerRow> {
  return transition(id, { state: "resolved", actor }, path, now);
}
