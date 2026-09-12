import { afterEach, expect, test } from "bun:test";
import { actToken, startActServer } from "./act";
import { createStubStore } from "./store";
import type { LedgerRow } from "./types";

const SECRET = "act-test-secret";
const NOW = new Date("2026-01-01T09:00:00.000Z");

function row(overrides: Partial<LedgerRow> = {}): LedgerRow {
  return {
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
    ...overrides,
  };
}

let server: ReturnType<typeof startActServer>;

function boot(rows: LedgerRow[]): string {
  const store = createStubStore({ rows, now: () => NOW });
  server = startActServer({ store, port: 0, secret: SECRET });
  return `http://127.0.0.1:${server.port}`;
}

afterEach(async () => {
  await server.stop(true);
});

test("healthz reports ok", async () => {
  const baseUrl = boot([row()]);
  expect((await fetch(`${baseUrl}/healthz`)).status).toBe(200);
});

test("a valid token renders three buttons for an open row", async () => {
  const baseUrl = boot([row()]);
  const token = actToken(row().id, SECRET);
  const response = await fetch(`${baseUrl}/act/${row().id}?t=${token}`);
  const text = await response.text();

  expect(response.status).toBe(200);
  expect(text.match(/<form/g)).toHaveLength(3);
  expect(text).toContain("Hold 1h");
  expect(text).toContain("After meeting");
  expect(text).toContain("Drop");
});

test("a bad token is forbidden", async () => {
  const baseUrl = boot([row()]);
  expect((await fetch(`${baseUrl}/act/${row().id}?t=wrong`)).status).toBe(403);
});

test("an unknown id is not found", async () => {
  const baseUrl = boot([row()]);
  const token = actToken("claude-hook:unknown", SECRET);
  expect((await fetch(`${baseUrl}/act/claude-hook:unknown?t=${token}`)).status).toBe(404);
});

test("POST hold-1h moves the row to held, releasing an hour out, and the page says so", async () => {
  const baseUrl = boot([row()]);
  const token = actToken(row().id, SECRET);
  const response = await fetch(`${baseUrl}/act/${row().id}`, {
    method: "POST",
    body: new URLSearchParams({ t: token, op: "hold-1h" }),
  });
  const text = await response.text();

  expect(text).toContain("Held until 10:00");
  expect(text).not.toContain("Hold 1h");
});

test("POST on an acked row leaves it acked and changes nothing", async () => {
  const baseUrl = boot([row({ state: "acked" })]);
  const token = actToken(row().id, SECRET);
  const response = await fetch(`${baseUrl}/act/${row().id}`, {
    method: "POST",
    body: new URLSearchParams({ t: token, op: "drop" }),
  });
  const text = await response.text();

  expect(text).toContain("Acked");
  expect(text).not.toContain("Drop</button>");
});
