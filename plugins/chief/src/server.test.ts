import { afterEach, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { read } from "./ledger";
import { startServer, type ChiefServer } from "./server";
import { createStubStore } from "./store";

const LEDGER_PATH = join(import.meta.dirname, "__fixtures__", "server.test.jsonl");

async function boot(): Promise<ChiefServer> {
  return startServer(
    {
      store: createStubStore(),
      ingestDeps: {
        ledgerPath: LEDGER_PATH,
        listAgents: () => Promise.resolve({ agents: [] }),
        now: () => new Date("2026-01-01T09:15:00.000Z"),
      },
    },
    { port: 0 },
  );
}

afterEach(async () => {
  await rm(LEDGER_PATH, { force: true });
});

test("healthz reports ok", async () => {
  const { server } = await boot();
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/healthz`, {
      headers: { host: `127.0.0.1:${server.port}` },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok" });
  } finally {
    await server.stop(true);
  }
});

test("ingest rejects a non-loopback Host", async () => {
  const { server } = await boot();
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/ingest`, {
      method: "POST",
      headers: { host: "evil.example.com", "content-type": "application/json" },
      body: JSON.stringify({ hook_event_name: "Stop", session_id: "s1" }),
    });
    expect(response.status).toBe(403);
    expect((await read(LEDGER_PATH)).size).toBe(0);
  } finally {
    await server.stop(true);
  }
});

test("ingest accepts a loopback Host and appends a tiered row", async () => {
  const { server } = await boot();
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/ingest`, {
      method: "POST",
      headers: { host: `127.0.0.1:${server.port}`, "content-type": "application/json" },
      body: JSON.stringify({ hook_event_name: "Stop", session_id: "s1" }),
    });
    expect(response.status).toBe(200);
    expect((await read(LEDGER_PATH)).size).toBe(1);
  } finally {
    await server.stop(true);
  }
});
