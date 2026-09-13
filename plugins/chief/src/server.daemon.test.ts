import { afterEach, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { append as appendLedger, read as readLedger } from "./ledger";
import { startDaemon, type ChiefDaemon } from "./server";
import { createLedgerStore } from "./store";
import type { LedgerRow } from "./types";

const FIXTURES = join(import.meta.dirname, "__fixtures__");
const LEDGER_PATH = join(FIXTURES, "server.daemon.test.ledger.jsonl");
const SPOOL_PATH = join(FIXTURES, "server.daemon.test.spool.jsonl");

function row(overrides: Partial<LedgerRow> = {}): LedgerRow {
  return {
    id: "claude-hook:s1:idle_prompt",
    key: "s1:idle_prompt",
    ts: "2026-01-01T00:00:00.000Z",
    source: "claude-hook",
    kind: "idle",
    title: "session idle",
    tier: "digest",
    releaseAt: "2026-01-01T08:00:00.000Z",
    state: "open",
    reason: "idle_prompt notification",
    actor: "manual",
    ...overrides,
  };
}

afterEach(async () => {
  await rm(LEDGER_PATH, { force: true });
  await rm(SPOOL_PATH, { force: true });
});

async function waitFor(condition: () => Promise<boolean> | boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    // oxlint-disable-next-line no-await-in-loop -- polling must happen serially
    if (await condition()) return;
    // oxlint-disable-next-line no-await-in-loop -- polling must happen serially
    await Bun.sleep(10);
  }
  throw new Error("condition never became true");
}

function boot(now: () => Date) {
  const scheduled: { fn: () => void; ms: number }[] = [];
  const rung: { agent: string; text: string | undefined }[] = [];

  const daemon = startDaemon(
    {
      ingestDeps: {
        listAgents: () => Promise.resolve({ agents: [] }),
        ledgerPath: LEDGER_PATH,
        now,
      },
      ledgerPath: LEDGER_PATH,
      spoolPath: SPOOL_PATH,
      herdrAgent: "chief",
      workHours: ["09:00", "18:00"],
      actSecret: "test-secret",
      createStore: (getLastDoorbell) =>
        createLedgerStore({ ledgerPath: LEDGER_PATH, decisionsPath: LEDGER_PATH, getLastDoorbell }),
      now,
      schedule: (fn, ms) => {
        scheduled.push({ fn, ms });
        return () => {};
      },
      ring: (agent, text) => {
        rung.push({ agent, text });
        return Promise.resolve({ status: "ok", attempts: 1 });
      },
    },
    { port: 0, actPort: 0 },
  );

  return { daemon, scheduled, rung };
}

test("drains the ingest spool at start", async () => {
  await Bun.write(SPOOL_PATH, `${JSON.stringify({ hook_event_name: "Stop", session_id: "s1" })}\n`);
  const { daemon } = boot(() => new Date("2026-01-01T09:00:00.000Z"));
  let running: ChiefDaemon | undefined;
  try {
    running = await daemon;
    expect((await readLedger(LEDGER_PATH)).size).toBe(1);
    expect(await Bun.file(SPOOL_PATH).text()).toBe("");
  } finally {
    running?.timers.stop();
    await running?.server.stop(true);
    await running?.act.stop(true);
  }
});

test("release check pushes due rows and rings the doorbell, feeding status.lastDoorbell", async () => {
  appendLedger(row(), LEDGER_PATH);
  const { daemon, scheduled, rung } = boot(() => new Date("2026-01-01T09:00:00.000Z"));
  let running: ChiefDaemon | undefined;
  try {
    running = await daemon;
    const [releaseCheck] = scheduled;
    expect(scheduled.map((entry) => entry.ms)).toEqual([60_000, 1_200_000]);

    releaseCheck?.fn();
    await waitFor(() => rung.length > 0);

    const rows = [...(await readLedger(LEDGER_PATH)).values()];
    expect(rows.find((candidate) => candidate.id === row().id)?.state).toBe("pushed");
    expect(rung).toEqual([{ agent: "chief", text: undefined }]);
  } finally {
    running?.timers.stop();
    await running?.server.stop(true);
    await running?.act.stop(true);
  }
});

test("flock tick rings the doorbell during work hours", async () => {
  const { daemon, scheduled, rung } = boot(() => new Date("2026-01-01T09:00:00.000Z"));
  let running: ChiefDaemon | undefined;
  try {
    running = await daemon;
    const [, flockTick] = scheduled;

    flockTick?.fn();
    await waitFor(() => rung.length > 0);

    expect(rung).toEqual([{ agent: "chief", text: "/flock tick" }]);
  } finally {
    running?.timers.stop();
    await running?.server.stop(true);
    await running?.act.stop(true);
  }
});
