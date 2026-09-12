import { afterEach, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { wasDecided } from "./decisions";
import { append as appendLedger } from "./ledger";
import { createLedgerStore, stateDir } from "./store";
import type { LedgerRow } from "./types";

const FIXTURES = join(import.meta.dirname, "__fixtures__");
const LEDGER_PATH = join(FIXTURES, "store.test.ledger.jsonl");
const DECISIONS_PATH = join(FIXTURES, "store.test.decisions.jsonl");

function row(overrides: Partial<LedgerRow> = {}): LedgerRow {
  return {
    id: "claude-hook:s1:idle_prompt",
    key: "s1:idle_prompt",
    ts: "2026-01-01T00:00:00.000Z",
    source: "claude-hook",
    kind: "idle",
    title: "session idle",
    tier: "digest",
    releaseAt: "2026-01-02T08:00:00.000Z",
    state: "open",
    reason: "idle_prompt notification",
    ...overrides,
  };
}

afterEach(async () => {
  await rm(LEDGER_PATH, { force: true });
  await rm(DECISIONS_PATH, { force: true });
});

test("stateDir honors CHIEF_STATE_DIR", () => {
  process.env.CHIEF_STATE_DIR = "/tmp/chief-store-test-state-dir";
  try {
    expect(stateDir()).toBe("/tmp/chief-store-test-state-dir");
  } finally {
    delete process.env.CHIEF_STATE_DIR;
  }
});

test("inbox returns the latest row per id, newest first, filtered by tier and state", async () => {
  appendLedger(row(), LEDGER_PATH);
  appendLedger(row({ ts: "2026-01-01T00:01:00.000Z", state: "acked" }), LEDGER_PATH);
  appendLedger(
    row({ id: "claude-hook:s2:idle_prompt", key: "s2:idle_prompt", tier: "now" }),
    LEDGER_PATH,
  );
  const store = createLedgerStore({ ledgerPath: LEDGER_PATH, decisionsPath: DECISIONS_PATH });

  expect(await store.inbox({ tier: "now" })).toEqual([
    row({ id: "claude-hook:s2:idle_prompt", key: "s2:idle_prompt", tier: "now" }),
  ]);
  expect(await store.inbox({ state: "acked" })).toHaveLength(1);
  expect(await store.inbox({})).toHaveLength(1);
});

test.each([
  {
    name: "hold",
    run: (store: ReturnType<typeof createLedgerStore>) =>
      store.hold({ id: "claude-hook:s1:idle_prompt", for: "1h" }),
    expected: "held",
  },
  {
    name: "drop",
    run: (store: ReturnType<typeof createLedgerStore>) =>
      store.drop({ id: "claude-hook:s1:idle_prompt" }),
    expected: "dropped",
  },
  {
    name: "ack",
    run: (store: ReturnType<typeof createLedgerStore>) =>
      store.ack({ id: "claude-hook:s1:idle_prompt" }),
    expected: "acked",
  },
] as const)("$name transitions the row to $expected", async ({ run, expected }) => {
  appendLedger(row(), LEDGER_PATH);
  const store = createLedgerStore({
    ledgerPath: LEDGER_PATH,
    decisionsPath: DECISIONS_PATH,
    now: () => new Date("2026-01-01T00:05:00.000Z"),
  });
  const next = await run(store);
  expect(next.state).toBe(expected);
});

test.each(["acked", "resolved", "dropped"] as const)(
  "hold and drop ignore a %s row",
  async (state) => {
    appendLedger(row({ state }), LEDGER_PATH);
    const store = createLedgerStore({ ledgerPath: LEDGER_PATH, decisionsPath: DECISIONS_PATH });

    const held = await store.hold({ id: "claude-hook:s1:idle_prompt", for: "1h" });
    expect(held.state).toBe(state);
    const dropped = await store.drop({ id: "claude-hook:s1:idle_prompt" });
    expect(dropped.state).toBe(state);
  },
);

test("ack appends a decision using the row's reason as the default note", async () => {
  appendLedger(row(), LEDGER_PATH);
  const store = createLedgerStore({
    ledgerPath: LEDGER_PATH,
    decisionsPath: DECISIONS_PATH,
    now: () => new Date("2026-01-01T00:05:00.000Z"),
    by: "test-user",
  });
  await store.ack({ id: "claude-hook:s1:idle_prompt" });
  expect(await wasDecided("claude-hook:s1:idle_prompt", DECISIONS_PATH)).toBe(true);
  expect((await Bun.file(DECISIONS_PATH).text()).trim()).toBe(
    JSON.stringify({
      ts: "2026-01-01T00:05:00.000Z",
      id: "claude-hook:s1:idle_prompt",
      note: "idle_prompt notification",
      by: "test-user",
    }),
  );
});

test("why returns every history line for an id plus the latest reason", async () => {
  appendLedger(row(), LEDGER_PATH);
  appendLedger(row({ ts: "2026-01-01T00:01:00.000Z", state: "pushed" }), LEDGER_PATH);
  appendLedger(row({ id: "claude-hook:s2:idle_prompt", key: "s2:idle_prompt" }), LEDGER_PATH);
  const store = createLedgerStore({ ledgerPath: LEDGER_PATH, decisionsPath: DECISIONS_PATH });

  const result = await store.why({ id: "claude-hook:s1:idle_prompt" });
  expect(result.history.map((entry) => entry.state)).toEqual(["open", "pushed"]);
  expect(result.reason).toBe("idle_prompt notification");
});

test("status reports presence, counts, uptime, and the last doorbell result", async () => {
  appendLedger(row(), LEDGER_PATH);
  appendLedger(row({ id: "claude-hook:s2", key: "s2", state: "acked" }), LEDGER_PATH);
  const startedAt = new Date("2026-01-01T00:00:00.000Z");
  const store = createLedgerStore({
    ledgerPath: LEDGER_PATH,
    decisionsPath: DECISIONS_PATH,
    startedAt,
    now: () => new Date("2026-01-01T00:10:00.000Z"),
    getLastDoorbell: () => "stalled",
  });

  const status = await store.status();
  expect(status.counts.digest.open).toBe(1);
  expect(status.counts.digest.acked).toBe(1);
  expect(status.daemonUptimeMs).toBe(10 * 60_000);
  expect(status.lastDoorbell).toBe("stalled");
});

test.each([
  { kind: "credential", tier: "now" },
  { kind: "destructive", tier: "now" },
  { kind: "idle", tier: "digest" },
  { kind: "unmapped-kind", tier: "digest" },
] as const)("append tiers a $kind row as $tier", async ({ kind, tier }) => {
  const store = createLedgerStore({
    ledgerPath: LEDGER_PATH,
    decisionsPath: DECISIONS_PATH,
    now: () => new Date("2026-01-01T09:00:00.000Z"),
  });
  const appended = await store.append({ key: `k:${kind}`, kind, title: "test append" });
  expect(appended.tier).toBe(tier);
  expect(appended.state).toBe("open");
});

test("append persists the optional payload", async () => {
  const store = createLedgerStore({ ledgerPath: LEDGER_PATH, decisionsPath: DECISIONS_PATH });
  const appended = await store.append({
    key: "k:payload",
    kind: "idle",
    title: "with payload",
    payload: { cwd: "/tmp" },
  });
  expect(appended.payload).toEqual({ cwd: "/tmp" });
});

test("dispatch creates a manual row tiered via tier()", async () => {
  const store = createLedgerStore({ ledgerPath: LEDGER_PATH, decisionsPath: DECISIONS_PATH });
  const dispatched = await store.dispatch({ text: "check on the deploy" });
  expect(dispatched.source).toBe("manual");
  expect(dispatched.kind).toBe("dispatch");
  expect(dispatched.state).toBe("open");
});
