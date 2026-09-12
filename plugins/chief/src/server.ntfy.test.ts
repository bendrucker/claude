import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NTFY_AVAILABLE, startServer, stopServer, type TestServer } from "../test/ntfy/harness";
import { append as appendLedger, read as readLedger } from "./ledger";
import type { NtfyConfig } from "./ntfy";
import { startDaemon, type ChiefDaemon } from "./server";
import { createLedgerStore } from "./store";
import type { LedgerRow } from "./types";

const NOW = new Date("2026-01-01T10:00:00.000Z");
const row: LedgerRow = {
  id: "claude-hook:s1:permission_prompt",
  key: "s1:permission_prompt",
  ts: "2026-01-01T09:00:00.000Z",
  source: "claude-hook",
  kind: "permission_prompt",
  title: "Approve tool use?",
  tier: "boundary",
  releaseAt: "2026-01-01T09:03:00.000Z",
  state: "open",
  reason: "permission_prompt notification",
};

async function waitFor(condition: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    // oxlint-disable-next-line no-await-in-loop -- polling must happen serially
    if (await condition()) return;
    // oxlint-disable-next-line no-await-in-loop -- polling must happen serially
    await Bun.sleep(50);
  }
  throw new Error("condition never became true");
}

describe.skipIf(!NTFY_AVAILABLE)("daemon over ntfy", () => {
  let server: TestServer;
  let dir: string;
  let daemon: ChiefDaemon;
  let ntfy: NtfyConfig;
  let releaseCheck: () => void;
  const rung: string[] = [];

  beforeAll(async () => {
    server = await startServer();
    dir = await mkdtemp(join(tmpdir(), "chief-ntfy-"));
    ntfy = { url: server.url, topic: "chief", replies: "chief-replies", token: server.token };
    const ledgerPath = join(dir, "ledger.jsonl");
    daemon = await startDaemon(
      {
        ingestDeps: {
          listAgents: () => Promise.resolve({ agents: [] }),
          ledgerPath,
          now: () => NOW,
        },
        ledgerPath,
        spoolPath: join(dir, "spool.jsonl"),
        herdrAgent: "chief",
        workHours: ["09:00", "18:00"],
        ntfy,
        createStore: (getLastDoorbell) =>
          createLedgerStore({
            ledgerPath,
            decisionsPath: join(dir, "decisions.jsonl"),
            getLastDoorbell,
            now: () => NOW,
          }),
        now: () => NOW,
        schedule: (fn, ms) => {
          if (ms === 60_000) releaseCheck = fn;
          return () => {};
        },
        ring: (agent) => {
          rung.push(agent);
          return Promise.resolve({ status: "ok", attempts: 1 });
        },
      },
      { port: 0 },
    );
    appendLedger(row, ledgerPath);
  });

  afterAll(async () => {
    daemon.unsubscribe();
    daemon.timers.stop();
    await daemon.server.stop(true);
    await stopServer(server);
    await rm(dir, { recursive: true, force: true });
  });

  test("a released row is published, and a Hold button reply holds it", async () => {
    const phone = await fetch(`${ntfy.url}/${ntfy.topic}/json`, {
      headers: { Authorization: `Bearer ${ntfy.token}` },
    });
    const reader = phone.body?.getReader();
    if (!reader) throw new Error("no subscription body");
    await Bun.sleep(200);

    releaseCheck();
    await waitFor(
      async () => (await readLedger(join(dir, "ledger.jsonl"))).get(row.id)?.state === "pushed",
    );
    expect(rung).toEqual(["chief"]);

    let text = "";
    const decoder = new TextDecoder();
    while (!text.includes('"event":"message"')) {
      // oxlint-disable-next-line no-await-in-loop -- streaming read
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value);
    }
    expect(text).toContain('"title":"Approve tool use?"');
    expect(text).toContain('"priority":3');

    const held = await fetch(`${ntfy.url}/${ntfy.replies}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ntfy.token}` },
      body: JSON.stringify({ id: row.id, op: "hold", for: "1h" }),
    });
    expect(held.ok).toBe(true);
    await waitFor(
      async () => (await readLedger(join(dir, "ledger.jsonl"))).get(row.id)?.state === "held",
    );
    expect((await readLedger(join(dir, "ledger.jsonl"))).get(row.id)?.releaseAt).toBe(
      "2026-01-01T11:00:00.000Z",
    );
  });
});
