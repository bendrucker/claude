import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { append as appendDecision } from "./decisions";
import {
  ack as ledgerAck,
  append as appendLedger,
  drop as ledgerDrop,
  hold as ledgerHold,
  holdReleaseAt,
  read as ledgerRead,
  type HoldInput as LedgerHoldInput,
} from "./ledger";
import { nextBoundary, nextDigest, parseDuration } from "./release";
import { tier, type Event, type ReleaseRule } from "./tiers";
import type { Actor, LedgerRow, Presence, Tier } from "./types";

export interface InboxInput {
  tier?: Tier | undefined;
  state?: LedgerRow["state"] | undefined;
  limit?: number | undefined;
}

export interface HoldInput {
  id: string;
  actor: Actor;
  for?: "1h" | "3h" | "1d" | undefined;
  until?: string | undefined;
}

export interface DropInput {
  id: string;
  actor: Actor;
}

export interface AckInput {
  id: string;
  actor: Actor;
  note?: string | undefined;
}

export interface DispatchInput {
  text: string;
  target?: "studio" | undefined;
}

export interface WhyInput {
  id: string;
}

export interface AppendInput {
  key: string;
  kind: string;
  title: string;
  payload?: Record<string, unknown> | undefined;
}

export interface StatusResult {
  presence: Presence;
  counts: Record<Tier, Record<LedgerRow["state"], number>>;
  daemonUptimeMs: number;
  lastDoorbell: "ok" | "stalled" | "skipped" | null;
}

export interface WhyResult {
  history: LedgerRow[];
  reason: string;
}

export interface Store {
  inbox(input: InboxInput): Promise<LedgerRow[]>;
  hold(input: HoldInput): Promise<LedgerRow>;
  drop(input: DropInput): Promise<LedgerRow>;
  ack(input: AckInput): Promise<LedgerRow>;
  dispatch(input: DispatchInput): Promise<LedgerRow>;
  status(): Promise<StatusResult>;
  why(input: WhyInput): Promise<WhyResult>;
  append(input: AppendInput): Promise<LedgerRow>;
}

// hold and drop no-op once a row has settled, so a stale phone action (or a retry) never
// reopens a decision the chief agent or another device already made.
const TERMINAL_STATES: ReadonlySet<LedgerRow["state"]> = new Set(["acked", "resolved", "dropped"]);

const STUB_PRESENCE: Presence = {
  focus: null,
  busyUntil: null,
  activeNode: "studio",
  updatedAt: new Date(0).toISOString(),
};

const EMPTY_STATE_COUNTS: Record<LedgerRow["state"], number> = {
  open: 0,
  held: 0,
  pushed: 0,
  acked: 0,
  resolved: 0,
  dropped: 0,
};

function emptyCounts(): Record<Tier, Record<LedgerRow["state"], number>> {
  return {
    now: { ...EMPTY_STATE_COUNTS },
    boundary: { ...EMPTY_STATE_COUNTS },
    digest: { ...EMPTY_STATE_COUNTS },
  };
}

export interface StubStoreOptions {
  rows?: LedgerRow[];
  presence?: Presence;
  workHours?: [string, string];
  startedAt?: Date;
  lastDoorbell?: "ok" | "stalled" | "skipped" | null;
  now?: () => Date;
}

const SAMPLE_ROW: LedgerRow = {
  id: "claude-hook:s1:idle_prompt",
  key: "s1:idle_prompt",
  ts: "2026-01-01T00:00:00.000Z",
  source: "claude-hook",
  kind: "idle",
  title: "session idle",
  session: "s1",
  tier: "digest",
  releaseAt: "2026-01-02T08:00:00.000Z",
  state: "open",
  reason: "idle_prompt notification",
  actor: "daemon",
};

export function createStubStore(options: StubStoreOptions = {}): Store {
  const rows = options.rows ?? [SAMPLE_ROW];
  const presence = options.presence ?? STUB_PRESENCE;
  const workHours = options.workHours ?? DEFAULT_WORK_HOURS;
  const startedAt = options.startedAt ?? new Date();
  const now = options.now ?? (() => new Date());
  let lastDoorbell = options.lastDoorbell ?? null;

  function find(id: string): LedgerRow {
    const row = rows.find((candidate) => candidate.id === id);
    if (!row) throw new Error(`no ledger row for id: ${id}`);
    return row;
  }

  function transition(id: string, patch: Partial<LedgerRow>): LedgerRow {
    const next: LedgerRow = { ...find(id), ...patch, id, ts: now().toISOString() };
    rows.push(next);
    return next;
  }

  return {
    inbox(input) {
      const wantedStates: readonly LedgerRow["state"][] =
        input.state !== undefined ? [input.state] : ["open", "held", "pushed"];
      const result = rows
        .filter((row) => input.tier === undefined || row.tier === input.tier)
        .filter((row) => wantedStates.includes(row.state))
        .slice(0, input.limit ?? rows.length)
        .toReversed();
      return Promise.resolve(result);
    },
    hold(input) {
      const current = find(input.id);
      if (TERMINAL_STATES.has(current.state)) return Promise.resolve(current);
      const nowValue = now();
      const releaseAt = holdReleaseAt(input, nowValue, { presence, workHours });
      return Promise.resolve(
        transition(input.id, { state: "held", releaseAt, actor: input.actor }),
      );
    },
    drop(input) {
      const current = find(input.id);
      if (TERMINAL_STATES.has(current.state)) return Promise.resolve(current);
      return Promise.resolve(transition(input.id, { state: "dropped", actor: input.actor }));
    },
    ack(input) {
      const reason = input.note != null && input.note !== "" ? input.note : find(input.id).reason;
      return Promise.resolve(transition(input.id, { state: "acked", reason, actor: input.actor }));
    },
    dispatch(input) {
      const row: LedgerRow = {
        id: `manual:dispatch:${now().toISOString()}`,
        key: `dispatch:${input.text}`,
        ts: now().toISOString(),
        source: "manual",
        kind: "dispatch",
        title: input.text,
        tier: "boundary",
        releaseAt: now().toISOString(),
        state: "open",
        reason: "dispatch request",
        actor: "chief",
      };
      rows.push(row);
      return Promise.resolve(row);
    },
    status() {
      const counts = emptyCounts();
      for (const row of rows) counts[row.tier][row.state] += 1;
      return Promise.resolve({
        presence,
        counts,
        daemonUptimeMs: now().getTime() - startedAt.getTime(),
        lastDoorbell,
      });
    },
    why(input) {
      const row = find(input.id);
      return Promise.resolve({
        history: rows.filter((candidate) => candidate.id === input.id),
        reason: row.reason,
      });
    },
    append(input) {
      const row: LedgerRow = {
        id: `claude-hook:${input.key}`,
        key: input.key,
        ts: now().toISOString(),
        source: "claude-hook",
        kind: input.kind,
        title: input.title,
        tier: "digest",
        releaseAt: now().toISOString(),
        state: "open",
        reason: `appended kind: ${input.kind}`,
        actor: "manual",
      };
      if (input.payload !== undefined) row.payload = input.payload;
      rows.push(row);
      lastDoorbell = lastDoorbell ?? "ok";
      return Promise.resolve(row);
    },
  };
}

export const DEFAULT_WORK_HOURS: [string, string] = ["09:00", "18:00"];
const DEFAULT_GRACE_PERMISSION = "3m";

export function stateDir(): string {
  return process.env.CHIEF_STATE_DIR ?? join(homedir(), ".local", "state", "chief");
}

// Node-originated appends carry a free-form `kind`; this bridges the known kinds onto
// tiers.ts's Event-shaped tier() so they get tiered by the same table hook events use,
// without tiers.ts needing to export its private TABLE.
const KIND_EVENTS: Partial<Record<string, Event>> = {
  credential: { hook: "Notification", notificationType: "", message: "credential" },
  destructive: { hook: "PermissionRequest", toolName: "Bash", toolInput: { command: "rm -rf" } },
  permission_prompt: { hook: "Notification", notificationType: "permission_prompt", message: "" },
  ask_user: { hook: "PostToolUse", toolName: "AskUserQuestion" },
  idle: { hook: "Notification", notificationType: "idle_prompt", message: "" },
  stop: { hook: "Stop" },
  dispatch: { hook: "dispatch" },
};

function releaseAtFor(
  rule: ReleaseRule,
  now: Date,
  presence: Presence,
  workHours: [string, string],
  gracePermission: string,
): string {
  switch (rule) {
    case "immediate":
      return now.toISOString();
    case "grace-permission":
      return new Date(now.getTime() + parseDuration(gracePermission)).toISOString();
    case "boundary":
      return nextBoundary(now, presence).toISOString();
    case "digest":
      return nextDigest(now, { workHours }).toISOString();
    default:
      return now.toISOString();
  }
}

function toLedgerHoldInput(input: HoldInput): LedgerHoldInput {
  const ledgerInput: LedgerHoldInput = { actor: input.actor };
  if (input.for !== undefined) ledgerInput.for = input.for;
  if (input.until !== undefined) ledgerInput.until = input.until;
  return ledgerInput;
}

const LEGACY_ACTOR: Actor = "manual";

const HistoryRowSchema = z.object({
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

// ledger.read() keeps only the latest row per id; `why` needs every line for one id, so
// this re-parses the file directly rather than adding a history-preserving export to ledger.ts.
async function readHistory(path: string, id: string): Promise<LedgerRow[]> {
  const file = Bun.file(path);
  if (!(await file.exists())) return [];

  const history: LedgerRow[] = [];
  for (const line of (await file.text()).split("\n")) {
    if (line.trim() === "") continue;
    let parsed: z.infer<typeof HistoryRowSchema>;
    try {
      parsed = HistoryRowSchema.parse(JSON.parse(line));
    } catch {
      continue;
    }
    if (parsed.id !== id) continue;
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
    history.push(row);
  }
  return history;
}

export interface LedgerStoreOptions {
  ledgerPath?: string;
  decisionsPath?: string;
  presence?: Presence;
  workHours?: [string, string];
  gracePermission?: string;
  now?: () => Date;
  startedAt?: Date;
  getLastDoorbell?: () => "ok" | "stalled" | "skipped" | null;
  by?: string;
}

export function createLedgerStore(options: LedgerStoreOptions = {}): Store {
  const ledgerPath = options.ledgerPath ?? join(stateDir(), "ledger.jsonl");
  const decisionsPath = options.decisionsPath ?? join(stateDir(), "decisions.jsonl");
  const presence = options.presence ?? STUB_PRESENCE;
  const workHours = options.workHours ?? DEFAULT_WORK_HOURS;
  const gracePermission = options.gracePermission ?? DEFAULT_GRACE_PERMISSION;
  const now = options.now ?? (() => new Date());
  const startedAt = options.startedAt ?? now();
  const getLastDoorbell = options.getLastDoorbell ?? (() => null);
  const by = options.by ?? "chief";

  async function find(id: string): Promise<LedgerRow> {
    const row = (await ledgerRead(ledgerPath)).get(id);
    if (!row) throw new Error(`no ledger row for id: ${id}`);
    return row;
  }

  return {
    async inbox(input) {
      const wantedStates: readonly LedgerRow["state"][] =
        input.state !== undefined ? [input.state] : ["open", "held", "pushed"];
      const rows = [...(await ledgerRead(ledgerPath)).values()]
        .filter((row) => input.tier === undefined || row.tier === input.tier)
        .filter((row) => wantedStates.includes(row.state))
        .toSorted((a, b) => b.ts.localeCompare(a.ts));
      return rows.slice(0, input.limit ?? rows.length);
    },
    async hold(input) {
      const current = await find(input.id);
      if (TERMINAL_STATES.has(current.state)) return current;
      return ledgerHold(input.id, toLedgerHoldInput(input), ledgerPath, {
        now: now(),
        presence,
        workHours,
      });
    },
    async drop(input) {
      const current = await find(input.id);
      if (TERMINAL_STATES.has(current.state)) return current;
      return ledgerDrop(input.id, input.actor, ledgerPath, now());
    },
    async ack(input) {
      const row = await find(input.id);
      const note = input.note ?? row.reason;
      const next = await ledgerAck(input.id, input.actor, ledgerPath, now());
      appendDecision({ ts: now().toISOString(), id: input.id, note, by }, decisionsPath);
      return next;
    },
    dispatch(input) {
      const nowValue = now();
      const result = tier({ hook: "dispatch" });
      if (!result) throw new Error("tier() returned no result for a dispatch event");
      const row: LedgerRow = {
        id: `manual:dispatch:${nowValue.toISOString()}`,
        key: `dispatch:${input.text}`,
        ts: nowValue.toISOString(),
        source: "manual",
        kind: "dispatch",
        title: input.text,
        tier: result.tier,
        releaseAt: releaseAtFor(result.releaseAt, nowValue, presence, workHours, gracePermission),
        state: "open",
        reason: result.reason,
        actor: "chief",
      };
      appendLedger(row, ledgerPath);
      return Promise.resolve(row);
    },
    async status() {
      const rows = [...(await ledgerRead(ledgerPath)).values()];
      const counts = emptyCounts();
      for (const row of rows) counts[row.tier][row.state] += 1;
      return {
        presence,
        counts,
        daemonUptimeMs: now().getTime() - startedAt.getTime(),
        lastDoorbell: getLastDoorbell(),
      };
    },
    async why(input) {
      const row = await find(input.id);
      const history = await readHistory(ledgerPath, input.id);
      return { history, reason: row.reason };
    },
    append(input) {
      const nowValue = now();
      const event = KIND_EVENTS[input.kind];
      const result = event ? tier(event) : null;
      const row: LedgerRow = {
        id: `claude-hook:${input.key}`,
        key: input.key,
        ts: nowValue.toISOString(),
        source: "claude-hook",
        kind: input.kind,
        title: input.title,
        tier: result?.tier ?? "digest",
        releaseAt: result
          ? releaseAtFor(result.releaseAt, nowValue, presence, workHours, gracePermission)
          : nowValue.toISOString(),
        state: "open",
        reason: result?.reason ?? `appended kind: ${input.kind}`,
        actor: "manual",
      };
      if (input.payload !== undefined) row.payload = input.payload;
      appendLedger(row, ledgerPath);
      return Promise.resolve(row);
    },
  };
}
