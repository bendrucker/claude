import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import {
  appendHookMetric,
  classifyOutcome,
  type HookMetric,
  type HookOutcome,
  resolveMetricsPath,
  timeHook,
} from "./hook-metrics";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hook-metrics-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function metricsPath(hook = "worktree"): string {
  return join(dir, `${hook}.jsonl`);
}

async function readLines(path: string): Promise<HookMetric[]> {
  const text = await Bun.file(path).text();
  return text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as HookMetric);
}

async function readOne(path: string): Promise<HookMetric> {
  const [entry] = await readLines(path);
  if (!entry) throw new Error(`no metric written to ${path}`);
  return entry;
}

test.each<[string, string | undefined, string | null]>([
  ["defaults to the home directory", undefined, join(homedir(), ".claude", "hook-metrics")],
  ["treats an on value as the default", "1", join(homedir(), ".claude", "hook-metrics")],
  ["treats any other value as a directory", "/var/metrics", "/var/metrics"],
  ["disables on 0", "0", null],
  ["disables on false", "FALSE", null],
  ["disables on off", "off", null],
])("resolveMetricsPath %s", (_name, env, expected) => {
  expect(resolveMetricsPath("worktree", env)).toBe(
    expected === null ? null : join(expected, "worktree.jsonl"),
  );
});

test("resolveMetricsPath sanitizes the hook name into a filename", () => {
  expect(resolveMetricsPath("plugins/writing pretooluse", "/m")).toBe(
    "/m/plugins-writing-pretooluse.jsonl",
  );
});

test.each<[HookOutcome, SyncHookJSONOutput | null]>([
  ["silent", null],
  ["deny", { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" } }],
  ["ask", { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask" } }],
  [
    "context",
    { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: "hi" } },
  ],
  ["block", { decision: "block", reason: "no" }],
  ["output", { systemMessage: "note" }],
])("classifyOutcome returns %s", (expected, output) => {
  expect(classifyOutcome(output)).toBe(expected);
});

test("timeHook records one line per invocation with the input's identifiers", async () => {
  const path = metricsPath();
  await timeHook(
    "worktree",
    { session_id: "abc", hook_event_name: "PreToolUse", tool_name: "Bash" },
    () => null,
    path,
  );

  const entry = await readOne(path);
  expect({ ...entry, ts: "<ts>", duration_ms: "<ms>" }).toMatchInlineSnapshot(`
    {
      "duration_ms": "<ms>",
      "hook_event": "PreToolUse",
      "outcome": "silent",
      "session_id": "abc",
      "tool": "Bash",
      "ts": "<ts>",
    }
  `);
  expect(Date.parse(entry.ts)).not.toBeNaN();
});

test("timeHook measures the wrapped call and returns its output", async () => {
  const path = metricsPath();
  const output: SyncHookJSONOutput = {
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" },
  };

  const returned = await timeHook(
    "worktree",
    { session_id: "abc" },
    async () => {
      await Bun.sleep(20);
      return output;
    },
    path,
  );

  expect(returned).toBe(output);
  const entry = await readOne(path);
  expect(entry.outcome).toBe("deny");
  expect(entry.duration_ms).toBeGreaterThanOrEqual(15);
  expect(entry.duration_ms).toBeLessThan(5000);
});

test("timeHook records an error outcome and rethrows", async () => {
  const path = metricsPath();
  const boom = new Error("boom");

  await expect(
    timeHook(
      "worktree",
      { session_id: "abc" },
      () => {
        throw boom;
      },
      path,
    ),
  ).rejects.toBe(boom);

  const entry = await readOne(path);
  expect(entry.outcome).toBe("error");
});

test("appendHookMetric appends rather than truncating, across hooks", async () => {
  const path = metricsPath();
  for (const outcome of ["silent", "deny", "ask"] as const) {
    appendHookMetric(
      "worktree",
      {
        ts: new Date().toISOString(),
        session_id: "abc",
        hook_event: "PreToolUse",
        tool: "Bash",
        duration_ms: 1,
        outcome,
      },
      path,
    );
  }

  expect((await readLines(path)).map((entry) => entry.outcome)).toEqual(["silent", "deny", "ask"]);
});

test("appendHookMetric writes nothing when metrics are disabled", async () => {
  const path = metricsPath();
  await timeHook("worktree", { session_id: "abc" }, () => null, null);
  expect(await Bun.file(path).exists()).toBe(false);
});

test("a failing write never throws out of the hook", async () => {
  // A directory where the file belongs makes every write fail.
  const path = join(dir, "worktree.jsonl");
  await Bun.write(join(path, "occupied"), "x");

  expect(() =>
    appendHookMetric(
      "worktree",
      {
        ts: new Date().toISOString(),
        session_id: "abc",
        hook_event: "PreToolUse",
        tool: null,
        duration_ms: 1,
        outcome: "silent",
      },
      path,
    ),
  ).not.toThrow();

  const returned = await timeHook("worktree", { session_id: "abc" }, () => null, path);
  expect(returned).toBeNull();
});
