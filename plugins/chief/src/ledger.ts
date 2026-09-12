// Ledger appends need O_APPEND atomicity across concurrent writers; Bun.write's
// read-modify-write would drop concurrent lines.
// oxlint-disable-next-line no-restricted-imports
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { nextBoundary, nextDigest, parseDuration } from "./release";
import type { LedgerRow, Presence } from "./types";

export const LEDGER_PATH = join(homedir(), ".local", "state", "chief", "ledger.jsonl");

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
    let row: LedgerRow;
    try {
      row = JSON.parse(line) as LedgerRow;
    } catch {
      continue;
    }
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
  for?: string;
  until?: "boundary" | "digest" | string;
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
  return transition(id, { state: "held", releaseAt: holdReleaseAt(input, now, ctx) }, path, now);
}

function holdReleaseAt(input: HoldInput, now: Date, ctx: HoldContext): string {
  if (input.for) return new Date(now.getTime() + parseDuration(input.for)).toISOString();
  if (input.until === "boundary") {
    return nextBoundary(now, ctx.presence ?? STUB_PRESENCE).toISOString();
  }
  if (input.until === "digest") {
    return nextDigest(now, { workHours: ctx.workHours ?? DEFAULT_WORK_HOURS }).toISOString();
  }
  if (input.until) return input.until;
  throw new Error("hold requires `for` or `until`");
}

export function drop(id: string, path: string = LEDGER_PATH, now: Date = new Date()): Promise<LedgerRow> {
  return transition(id, { state: "dropped" }, path, now);
}

export function ack(id: string, path: string = LEDGER_PATH, now: Date = new Date()): Promise<LedgerRow> {
  return transition(id, { state: "acked" }, path, now);
}

export function resolve(
  id: string,
  path: string = LEDGER_PATH,
  now: Date = new Date(),
): Promise<LedgerRow> {
  return transition(id, { state: "resolved" }, path, now);
}
