import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { ensureIndex, getDb } from "../../../skills/session/scripts/db";
import { loadTruth } from "./score";

const dir = mkdtempSync(join(tmpdir(), "session-eval-truth-"));
const index = join(dir, "index", "session.duckdb");
const base = { sessionId: "truth-session", cwd: "/Users/test/truth" };

const use = (id: string, name: string, timestamp: string) => ({
  ...base,
  type: "assistant",
  uuid: `${id}-use`,
  timestamp,
  message: { role: "assistant", content: [{ type: "tool_use", id, name, input: {} }] },
});
const denied = (id: string, content: string, timestamp: string, extra = {}) => ({
  ...base,
  type: "user",
  uuid: `${id}-result`,
  timestamp,
  message: {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: id, content, is_error: true }],
  },
  ...extra,
});
const decision = (source: string) => ({ permissionDecision: { decision: "reject", source } });
const text = (uuid: string, value: string, timestamp: string) => ({
  ...base,
  type: "user",
  uuid,
  timestamp,
  message: { role: "user", content: [{ type: "text", text: value }] },
});
const context = (uuid: string, hookName: string) => ({
  ...base,
  type: "attachment",
  uuid,
  timestamp: "2026-10-01T00:00:00Z",
  attachment: { type: "hook_additional_context", hookName },
});
const apiError = (uuid: string, error: Record<string, unknown>) => ({
  ...base,
  type: "system",
  subtype: "api_error",
  uuid,
  timestamp: "2026-09-01T00:00:00Z",
  error,
});

const lines = [
  use("field", "Bash", "2026-10-01T00:00:00Z"),
  denied("field", "PreToolUse:Bash hook error: no", "2026-10-01T00:00:01Z", decision("hook")),
  // A replayed line repeats its uuid and tool id, and counts once.
  denied("field", "PreToolUse:Bash hook error: no", "2026-10-01T00:00:01Z", decision("hook")),
  use("config", "Bash", "2026-10-01T00:00:02Z"),
  denied(
    "config",
    "Permission to use Bash has been denied.",
    "2026-10-01T00:00:03Z",
    decision("config"),
  ),
  use("prefix", "Edit", "2026-09-20T00:00:00Z"),
  denied("prefix", "PreToolUse:Edit hook error: no", "2026-09-20T00:00:01Z"),
  use("plan", "ExitPlanMode", "2026-08-01T00:00:00Z"),
  denied("plan", "PreToolUse:ExitPlanMode hook error: too long", "2026-08-01T00:00:01Z"),
  text("int-1", "[Request interrupted by user]", "2026-09-10T00:00:00Z"),
  text("int-2", "[Request interrupted by user for tool use]", "2026-09-11T00:00:00Z"),
  text("int-3", "[Request interrupted by user]", "2026-10-02T00:00:00Z"),
  context("ctx-1", "PreToolUse:Bash"),
  context("ctx-2", "PreToolUse:Bash"),
  context("ctx-3", "SessionStart"),
  apiError("api-1", { status: 429 }),
  apiError("api-2", { status: 429 }),
  apiError("api-3", { connection: { code: "ECONNRESET" } }),
];

beforeAll(async () => {
  const projects = join(dir, "projects", "-Users-test-truth");
  mkdirSync(projects, { recursive: true });
  mkdirSync(join(dir, "index"));
  await Bun.write(join(projects, "truth.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n"));
  const db = await getDb(join(dir, "index"));
  await ensureIndex(db, { projectsDir: join(dir, "projects"), importsDir: join(dir, "imports") });
  db.close();
});

afterAll(async () => {
  await $`rm -rf ${dir}`;
});

const truth = async (name: string) =>
  (await loadTruth(join(import.meta.dirname, "..", name), index)).rows;

test.each([
  [
    "drift-hook-denies",
    [
      { key: "Bash", value: 1 },
      { key: "Edit", value: 1 },
    ],
  ],
  ["drift-plan-denies", [{ value: 1 }]],
  ["drift-interruptions", [{ value: 2 }]],
  [
    "drift-context-adds",
    [
      { key: "PreToolUse:Bash", value: 2 },
      { key: "SessionStart", value: 1 },
    ],
  ],
  [
    "drift-api-errors",
    [
      { key: "429", value: 2 },
      { key: "ECONNRESET", value: 1 },
    ],
  ],
])("%s reads the native fields", async (name, want) => {
  const got = await truth(name);
  expect(got.toSorted((a, b) => String(a.key).localeCompare(String(b.key)))).toEqual(
    want.toSorted((a, b) => String(a.key).localeCompare(String(b.key))),
  );
});
