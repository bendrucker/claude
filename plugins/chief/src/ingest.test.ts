import { afterEach, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { append, read } from "./ledger";
import { drainSpool, ingest, resolvePane, type HookPayload, type IngestDeps } from "./ingest";
import type { LedgerRow } from "./types";

const LEDGER_PATH = join(import.meta.dirname, "__fixtures__", "ingest-ledger.test.jsonl");
const SPOOL_PATH = join(import.meta.dirname, "__fixtures__", "ingest-spool.test.jsonl");

const NO_AGENTS: IngestDeps["listAgents"] = () => Promise.resolve({ agents: [] });

function deps(overrides: Partial<IngestDeps> = {}): IngestDeps {
  return {
    ledgerPath: LEDGER_PATH,
    listAgents: NO_AGENTS,
    now: () => new Date("2026-01-01T09:15:00.000Z"),
    ...overrides,
  };
}

afterEach(async () => {
  await rm(LEDGER_PATH, { force: true });
  await rm(SPOOL_PATH, { force: true });
});

test("resolvePane matches a session id against herdr agent list output", async () => {
  const pane = await resolvePane("s1", () =>
    Promise.resolve({
      agents: [
        { pane: "%1", agent_session: { value: "other" } },
        { pane: "%2", agent_session: { value: "s1" } },
      ],
    }),
  );
  expect(pane).toBe("%2");
});

test.each<[string, HookPayload, Partial<LedgerRow>]>([
  [
    "credential Notification",
    {
      hook_event_name: "Notification",
      session_id: "s1",
      notification_type: "idle_prompt",
      message: "please authenticate",
    },
    { kind: "credential", tier: "now", releaseAt: "2026-01-01T09:15:00.000Z", state: "open" },
  ],
  [
    "permission_prompt Notification",
    {
      hook_event_name: "Notification",
      session_id: "s1",
      notification_type: "permission_prompt",
      message: "waiting on approval",
    },
    { kind: "permission_prompt", tier: "boundary", releaseAt: "2026-01-01T09:18:00.000Z" },
  ],
  [
    "idle_prompt Notification",
    {
      hook_event_name: "Notification",
      session_id: "s1",
      notification_type: "idle_prompt",
      message: "still there?",
    },
    { kind: "idle", tier: "digest", releaseAt: "2026-01-01T18:00:00.000Z" },
  ],
  [
    "destructive PermissionRequest",
    {
      hook_event_name: "PermissionRequest",
      session_id: "s1",
      tool_name: "Bash",
      tool_input: { command: "rm -rf tmp/" },
    },
    { kind: "destructive", tier: "now", releaseAt: "2026-01-01T09:15:00.000Z" },
  ],
  [
    "AskUserQuestion PostToolUse",
    { hook_event_name: "PostToolUse", session_id: "s1", tool_name: "AskUserQuestion" },
    { kind: "ask_user", tier: "boundary" },
  ],
  [
    "Stop",
    { hook_event_name: "Stop", session_id: "s1" },
    { kind: "stop", tier: "digest", releaseAt: "2026-01-01T18:00:00.000Z" },
  ],
])("%s appends a tiered row", async (_name, payload, expected) => {
  const row = await ingest(payload, deps());
  expect(row).toMatchObject(expected);
  expect((await read(LEDGER_PATH)).get(row!.id)).toEqual(row);
});

test("a non-destructive PermissionRequest appends nothing", async () => {
  const row = await ingest(
    {
      hook_event_name: "PermissionRequest",
      session_id: "s1",
      tool_name: "Bash",
      tool_input: { command: "ls" },
    },
    deps(),
  );
  expect(row).toBeUndefined();
  expect((await read(LEDGER_PATH)).size).toBe(0);
});

test("Stop resolves an open permission_prompt row for the same session", async () => {
  await ingest(
    {
      hook_event_name: "Notification",
      session_id: "s1",
      notification_type: "permission_prompt",
      message: "waiting",
    },
    deps(),
  );
  await ingest({ hook_event_name: "Stop", session_id: "s1" }, deps());

  const rows = [...(await read(LEDGER_PATH)).values()];
  const permissionRow = rows.find((row) => row.kind === "permission_prompt");
  expect(permissionRow?.state).toBe("resolved");
});

test("SessionStart resolves every open row for the session", async () => {
  await ingest(
    { hook_event_name: "PostToolUse", session_id: "s1", tool_name: "AskUserQuestion" },
    deps(),
  );
  await ingest({ hook_event_name: "SessionStart", session_id: "s1" }, deps());

  const rows = [...(await read(LEDGER_PATH)).values()];
  expect(rows.every((row) => row.session !== "s1" || row.state === "resolved")).toBe(true);
});

test("drainSpool replays spooled payloads in order and truncates the file", async () => {
  const payloads: HookPayload[] = [
    { hook_event_name: "Stop", session_id: "s1" },
    { hook_event_name: "PostToolUse", session_id: "s1", tool_name: "AskUserQuestion" },
  ];
  await Bun.write(SPOOL_PATH, `${payloads.map((p) => JSON.stringify(p)).join("\n")}\n{"broken"`);

  const count = await drainSpool(SPOOL_PATH, deps());
  expect(count).toBe(2);
  expect((await read(LEDGER_PATH)).size).toBe(2);
  expect(await Bun.file(SPOOL_PATH).text()).toBe("");
});

test("drainSpool is a no-op for a missing file", async () => {
  expect(await drainSpool(SPOOL_PATH, deps())).toBe(0);
});

test("does not throw on an already-resolved row when re-ingesting Stop", async () => {
  append(
    {
      id: "claude-hook:s1:permission_prompt",
      key: "s1:permission_prompt",
      ts: "2026-01-01T00:00:00.000Z",
      source: "claude-hook",
      kind: "permission_prompt",
      title: "waiting",
      session: "s1",
      tier: "boundary",
      releaseAt: "2026-01-01T00:03:00.000Z",
      state: "resolved",
      reason: "permission_prompt notification",
    },
    LEDGER_PATH,
  );
  await ingest({ hook_event_name: "Stop", session_id: "s1" }, deps());
  const rows = [...(await read(LEDGER_PATH)).values()];
  expect(rows.find((row) => row.kind === "permission_prompt")?.state).toBe("resolved");
});
