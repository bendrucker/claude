import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ack, append, drop, hold, read, resolve, transition } from "./ledger";
import type { LedgerRow } from "./types";

let dir: string;
let PATH: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "chief-ledger-"));
  PATH = join(dir, "ledger.test.jsonl");
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function row(overrides: Partial<LedgerRow> = {}): LedgerRow {
  return {
    id: "claude-hook:s1:idle_prompt",
    key: "s1:idle_prompt",
    ts: "2026-01-01T00:00:00.000Z",
    source: "claude-hook",
    kind: "idle",
    title: "idle",
    tier: "digest",
    releaseAt: "2026-01-01T08:00:00.000Z",
    state: "open",
    reason: "idle_prompt notification",
    actor: "manual",
    ...overrides,
  };
}

afterEach(async () => {
  await rm(PATH, { force: true });
});

test("read returns an empty map for a missing file", async () => {
  expect(await read(PATH)).toEqual(new Map());
});

test("append then read returns the latest row per id", async () => {
  append(row(), PATH);
  append(row({ ts: "2026-01-01T00:01:00.000Z", state: "pushed" }), PATH);
  const latest = await read(PATH);
  expect(latest.size).toBe(1);
  expect(latest.get("claude-hook:s1:idle_prompt")?.state).toBe("pushed");
});

test("read tolerates a truncated last line", async () => {
  append(row(), PATH);
  await Bun.write(PATH, `${await Bun.file(PATH).text()}{"id":"broken"`);
  const latest = await read(PATH);
  expect([...latest.keys()]).toEqual(["claude-hook:s1:idle_prompt"]);
});

test("transition appends a superseding row", async () => {
  append(row(), PATH);
  const next = await transition("claude-hook:s1:idle_prompt", { state: "acked" }, PATH);
  expect(next.state).toBe("acked");
  expect((await read(PATH)).get(next.id)).toEqual(next);
});

test("transition rejects an unknown id", () => {
  expect(transition("claude-hook:missing", { state: "acked" }, PATH)).rejects.toThrow(
    "no ledger row for id: claude-hook:missing",
  );
});

describe("hold", () => {
  test("`for` adds a duration to now", async () => {
    append(row(), PATH);
    const now = new Date("2026-01-01T00:00:00.000Z");
    const held = await hold("claude-hook:s1:idle_prompt", { actor: "chief", for: "1h" }, PATH, {
      now,
    });
    expect(held.state).toBe("held");
    expect(held.releaseAt).toBe("2026-01-01T01:00:00.000Z");
    expect(held.actor).toBe("chief");
  });

  test("`until: boundary` resolves via nextBoundary", async () => {
    append(row(), PATH);
    const now = new Date("2026-01-01T09:15:00.000Z");
    const held = await hold(
      "claude-hook:s1:idle_prompt",
      { actor: "chief", until: "boundary" },
      PATH,
      { now },
    );
    expect(held.releaseAt).toBe("2026-01-01T10:00:00.000Z");
  });

  test("`until: digest` resolves via nextDigest", async () => {
    append(row(), PATH);
    const now = new Date("2026-01-01T19:00:00.000Z");
    const held = await hold(
      "claude-hook:s1:idle_prompt",
      { actor: "chief", until: "digest" },
      PATH,
      { now },
    );
    expect(held.releaseAt).toBe("2026-01-02T08:00:00.000Z");
  });

  test("`until` as an ISO string passes through", async () => {
    append(row(), PATH);
    const held = await hold(
      "claude-hook:s1:idle_prompt",
      { actor: "chief", until: "2026-02-01T00:00:00.000Z" },
      PATH,
    );
    expect(held.releaseAt).toBe("2026-02-01T00:00:00.000Z");
  });

  test("requires `for` or `until`", () => {
    append(row(), PATH);
    expect(hold("claude-hook:s1:idle_prompt", { actor: "chief" }, PATH)).rejects.toThrow(
      "hold requires `for` or `until`",
    );
  });
});

test.each([
  ["drop", drop, "dropped"],
  ["ack", ack, "acked"],
  ["resolve", resolve, "resolved"],
] as const)("%s transitions to %s and records the actor", async (_name, op, state) => {
  append(row(), PATH);
  const next = await op("claude-hook:s1:idle_prompt", "chief", PATH);
  expect(next.state).toBe(state);
  expect(next.actor).toBe("chief");
});
