import type { LedgerRow, Presence, Tier } from "./types";

export interface InboxInput {
  tier?: Tier;
  state?: LedgerRow["state"];
  limit?: number;
}

export interface HoldInput {
  id: string;
  for?: "1h" | "3h" | "1d";
  until?: string;
}

export interface AckInput {
  id: string;
  note?: string;
}

export interface DispatchInput {
  text: string;
  target?: "studio";
}

export interface WhyInput {
  id: string;
}

export interface AppendInput {
  key: string;
  kind: string;
  title: string;
  payload?: Record<string, unknown>;
}

export interface StatusResult {
  presence: Presence;
  counts: Record<Tier, Record<LedgerRow["state"], number>>;
  daemonUptimeMs: number;
  lastDoorbell: "ok" | "stalled" | null;
}

export interface WhyResult {
  history: LedgerRow[];
  reason: string;
}

export interface Store {
  inbox(input: InboxInput): Promise<LedgerRow[]>;
  hold(input: HoldInput): Promise<LedgerRow>;
  ack(input: AckInput): Promise<LedgerRow>;
  dispatch(input: DispatchInput): Promise<LedgerRow>;
  status(): Promise<StatusResult>;
  why(input: WhyInput): Promise<WhyResult>;
  append(input: AppendInput): Promise<LedgerRow>;
}

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
  return { now: { ...EMPTY_STATE_COUNTS }, boundary: { ...EMPTY_STATE_COUNTS }, digest: { ...EMPTY_STATE_COUNTS } };
}

export interface StubStoreOptions {
  rows?: LedgerRow[];
  presence?: Presence;
  startedAt?: Date;
  lastDoorbell?: "ok" | "stalled" | null;
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
};

export function createStubStore(options: StubStoreOptions = {}): Store {
  const rows = options.rows ?? [SAMPLE_ROW];
  const presence = options.presence ?? STUB_PRESENCE;
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
      const wantedStates = input.state !== undefined ? [input.state] : (["open", "held", "pushed"] as const);
      const result = rows
        .filter((row) => input.tier === undefined || row.tier === input.tier)
        .filter((row) => wantedStates.includes(row.state))
        .slice(0, input.limit ?? rows.length)
        .toReversed();
      return Promise.resolve(result);
    },
    hold(input) {
      const releaseAt = input.until != null && input.until !== "" ? input.until : now().toISOString();
      return Promise.resolve(transition(input.id, { state: "held", releaseAt }));
    },
    ack(input) {
      const reason = input.note != null && input.note !== "" ? input.note : find(input.id).reason;
      return Promise.resolve(transition(input.id, { state: "acked", reason }));
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
      };
      if (input.payload !== undefined) row.payload = input.payload;
      rows.push(row);
      lastDoorbell = lastDoorbell ?? "ok";
      return Promise.resolve(row);
    },
  };
}
