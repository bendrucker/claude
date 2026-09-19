// Leads, threads and the status pass all append to one queue, so writes need
// O_APPEND atomicity, and reads inside the id lock have to be synchronous.
// oxlint-disable no-restricted-imports -- a lock read and the append it guards have to be synchronous, which Bun's file API cannot be.
import {
  appendFileSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
// oxlint-enable no-restricted-imports
import { join } from "node:path";
import { z } from "zod";
import { readResolutions, type Resolution } from "./capture";
import { type Runner, spawnRunner } from "./dispatch";
import { MAX_NOTE } from "./threads";

export const KINDS = ["review", "question"] as const;
export type Kind = (typeof KINDS)[number];

// `acked` closes an item Ben only had to see, `answered` a question he replied
// to, `resolved` a review whose pull request landed.
export const CLEARED = ["acked", "answered", "resolved"] as const;
export type Cleared = (typeof CLEARED)[number];
export const STATES = ["open", ...CLEARED] as const;
export type ItemState = (typeof STATES)[number];

export const BEN = "ben";

// One line per state an item has been in, written when that state was reached.
// The latest row per id is the item's state, and only an `open` one is still
// waiting on Ben.
export const QueueRow = z.object({
  id: z.string(),
  ts: z.string(),
  kind: z.enum(KINDS),
  text: z.string(),
  state: z.enum(STATES),
  url: z.string().optional(),
  thread: z.object({ repo: z.string(), branch: z.string() }).optional(),
  agent: z.string().optional(),
  pane: z.string().optional(),
  // Whether herdr carried the answer back to the agent that asked.
  answer: z.string().optional(),
  delivered: z.boolean().optional(),
  // Who cleared it: Ben, a lead writing on his word, or `pr` for one the
  // status pass resolved against the request it points at.
  by: z.string().optional(),
});
export type QueueItem = z.infer<typeof QueueRow>;

export function queuePath(dataDir: string): string {
  return join(dataDir, "queue.jsonl");
}

// A line that fails to parse is reported and skipped rather than failing the
// read: the queue is reprinted at every compaction, and one bad line must not
// hide every good one.
export function readQueue(
  dataDir: string,
  warn: (message: string) => void = (message) => process.stderr.write(`${message}\n`),
): QueueItem[] {
  const path = queuePath(dataDir);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const items: QueueItem[] = [];
  for (const [index, line] of text.split("\n").entries()) {
    if (line.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      warn(`${path}:${index + 1}: not JSON, skipped`);
      continue;
    }
    const result = QueueRow.safeParse(parsed);
    if (result.success) items.push(result.data);
    else {
      const issues = result.error.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`,
      );
      warn(`${path}:${index + 1}: ${issues.join("; ")}, skipped`);
    }
  }
  return items;
}

export function appendItem(row: QueueItem, dataDir: string): void {
  mkdirSync(dataDir, { recursive: true });
  appendFileSync(queuePath(dataDir), `${JSON.stringify(row)}\n`);
}

// The latest row per id, in the order the ids first appeared.
export function latestItems(rows: readonly QueueItem[]): QueueItem[] {
  const latest = new Map<string, QueueItem>();
  for (const row of rows) latest.set(row.id, row);
  return [...latest.values()];
}

function raised(item: QueueItem): number {
  const parsed = Date.parse(item.ts);
  return Number.isNaN(parsed) ? 0 : parsed;
}

// Oldest first: what has waited longest is what Ben owes an answer to first.
export function openItems(rows: readonly QueueItem[]): QueueItem[] {
  return latestItems(rows)
    .filter((item) => item.state === "open")
    .toSorted((a, b) => raised(a) - raised(b));
}

// An id is the next number in the file, so two pushes that read it at once
// would hand out the same one. Creating the lock is the atomic step. One older
// than any command could still be holding is taken rather than waited on, so a
// killed process cannot wedge the queue.
const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 20;
const LOCK_ATTEMPTS = 200;

function withLock<T>(dataDir: string, write: () => T): T {
  mkdirSync(dataDir, { recursive: true });
  const path = join(dataDir, "queue.lock");
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
    let held: number;
    try {
      held = openSync(path, "wx");
    } catch {
      const stat = statSync(path, { throwIfNoEntry: false });
      if (stat != null && Date.now() - stat.mtimeMs > LOCK_STALE_MS) rmSync(path, { force: true });
      Bun.sleepSync(LOCK_WAIT_MS);
      continue;
    }
    try {
      return write();
    } finally {
      closeSync(held);
      rmSync(path, { force: true });
    }
  }
  throw new Error(`${path} is held, so the queue was not written`);
}

const ID_NUMBER = /^q(\d+)$/;
const Identified = z.object({ id: z.string() });

// Ids are read without validating the rest of the row, because a row the
// schema rejects still holds an id that must not be handed out twice.
function nextId(dataDir: string): string {
  let text: string;
  try {
    text = readFileSync(queuePath(dataDir), "utf8");
  } catch {
    return "q1";
  }
  let highest = 0;
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const identified = Identified.safeParse(parsed);
    const digits = identified.success ? ID_NUMBER.exec(identified.data.id)?.[1] : undefined;
    if (digits != null) highest = Math.max(highest, Number(digits));
  }
  return `q${highest + 1}`;
}

// Nothing prunes an append-only file, so caller text is bounded exactly as the
// ledger's note is, and an oversized value is refused rather than trimmed.
function bounded(label: string, value: string): string {
  if (value.trim() === "") throw new Error(`${label} cannot be empty`);
  if (value.length > MAX_NOTE)
    throw new Error(`${label} takes at most ${MAX_NOTE} characters, given ${value.length}`);
  return value;
}

export interface PushInput {
  kind: Kind;
  text: string;
  url?: string | undefined;
  thread?: { repo: string; branch: string } | undefined;
  agent?: string | undefined;
  pane?: string | undefined;
}

export function pushItem(
  input: PushInput,
  dataDir: string,
  now: () => Date = () => new Date(),
): QueueItem {
  bounded("text", input.text);
  return withLock(dataDir, () => {
    const row: QueueItem = {
      id: nextId(dataDir),
      ts: now().toISOString(),
      kind: input.kind,
      text: input.text,
      state: "open",
    };
    if (input.url != null) row.url = input.url;
    if (input.thread != null) row.thread = input.thread;
    if (input.agent != null) row.agent = input.agent;
    if (input.pane != null) row.pane = input.pane;
    appendItem(row, dataDir);
    return row;
  });
}

export interface ClearInput {
  id: string;
  state: Cleared;
  by: string;
  answer?: string | undefined;
  delivered?: boolean | undefined;
}

function find(id: string, dataDir: string): QueueItem {
  const latest = latestItems(readQueue(dataDir, () => {})).find((item) => item.id === id);
  if (latest == null) throw new Error(`no queue item ${id} in ${queuePath(dataDir)}`);
  return latest;
}

// The closing row copies the item's identity from its latest row, so every row
// stands alone and folding is a pass over one file. An answer explains one
// state, so it does not carry over to the next.
export function clearItem(
  input: ClearInput,
  dataDir: string,
  now: () => Date = () => new Date(),
): QueueItem {
  return withLock(dataDir, () => {
    const latest = find(input.id, dataDir);
    if (latest.state !== "open") throw new Error(`${input.id} is already ${latest.state}`);
    const { answer: _answer, delivered: _delivered, by: _by, ...carried } = latest;
    const row: QueueItem = {
      ...carried,
      ts: now().toISOString(),
      state: input.state,
      by: input.by,
    };
    if (input.answer != null) row.answer = input.answer;
    if (input.delivered != null) row.delivered = input.delivered;
    appendItem(row, dataDir);
    return row;
  });
}

// The answer is recorded whether or not herdr took it anywhere, so Ben's words
// survive an agent that has gone away.
export async function answerItem(
  id: string,
  answer: string,
  by: string,
  dataDir: string,
  run: Runner = spawnRunner,
  now?: () => Date,
): Promise<QueueItem> {
  bounded("answer", answer);
  const agent = find(id, dataDir).agent;
  const delivered =
    agent == null ? false : (await run(["herdr", "agent", "prompt", agent, answer])).code === 0;
  return clearItem({ id, state: "answered", by, answer, delivered }, dataDir, now);
}

// A review item points at the thing being reviewed, so a request that merged or
// closed clears it without anyone typing a command. A lookup that cannot say
// leaves the item standing, because losing one is worse than carrying one whose
// request has already landed.
export async function resolveLanded(
  items: readonly QueueItem[],
  dataDir: string,
  read: (urls: readonly string[]) => Promise<ReadonlyMap<string, Resolution>> = readResolutions,
  now?: () => Date,
): Promise<QueueItem[]> {
  const urls = [
    ...new Set(
      items.flatMap((item) => (item.kind === "review" && item.url != null ? [item.url] : [])),
    ),
  ];
  if (urls.length === 0) return [...items];
  const landed = await read(urls);
  return items.flatMap((item) => {
    if (item.kind !== "review" || item.url == null || landed.get(item.url) !== "closed")
      return [item];
    try {
      clearItem({ id: item.id, state: "resolved", by: "pr" }, dataDir, now);
      return [];
    } catch {
      return [item];
    }
  });
}
