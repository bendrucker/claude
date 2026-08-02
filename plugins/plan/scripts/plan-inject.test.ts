import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scriptPath = join(import.meta.dirname, "plan-inject.sh");

let markerRoot: string;

beforeEach(() => {
  markerRoot = mkdtempSync(join(tmpdir(), "plan-inject-"));
});

afterEach(async () => {
  await rm(markerRoot, { recursive: true, force: true });
});

async function run(input: unknown): Promise<string> {
  const proc = Bun.spawn(["bash", scriptPath], {
    stdin: Buffer.from(JSON.stringify(input)),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, CLAUDE_PLAN_MARKER_ROOT: markerRoot },
  });
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  return stdout;
}

async function opusTranscript(): Promise<string> {
  const line = JSON.stringify({
    type: "assistant",
    message: { role: "assistant", model: "claude-opus-4-8", content: [] },
  });
  const path = join(markerRoot, "transcript.jsonl");
  await Bun.write(path, `${line}\n`);
  return path;
}

test("emits additionalContext JSON on first plan-mode tool call", async () => {
  const stdout = await run({ permission_mode: "plan", session_id: "t1" });
  const parsed = JSON.parse(stdout);
  expect(parsed.hookSpecificOutput.hookEventName).toBe("PreToolUse");
  expect(parsed.hookSpecificOutput.additionalContext).toContain("Planning Guidelines");
});

test("touches the marker so a second call short-circuits", async () => {
  await run({ permission_mode: "plan", session_id: "t1" });
  expect(await Bun.file(join(markerRoot, "t1", "plan-injected")).exists()).toBe(true);
  const second = await run({ permission_mode: "plan", session_id: "t1" });
  expect(second).toBe("");
});

test.each<{ name: string; input: Record<string, unknown> }>([
  { name: "outside plan mode", input: { permission_mode: "default", session_id: "t1" } },
  {
    name: "on a PreToolUse for EnterPlanMode, which has not landed yet",
    input: { hook_event_name: "PreToolUse", permission_mode: "auto", session_id: "t1" },
  },
  {
    name: "without a session_id, since a high-frequency hook cannot dedup",
    input: { permission_mode: "plan" },
  },
  {
    name: "for a subagent, whose session_id is the parent's",
    input: { hook_event_name: "PostToolUse", session_id: "t1", agent_id: "sub1" },
  },
])("stays silent $name", async ({ input }) => {
  expect(await run(input)).toBe("");
});

test("injects once EnterPlanMode has landed, whatever mode the call carried", async () => {
  const stdout = await run({
    hook_event_name: "PostToolUse",
    permission_mode: "auto",
    session_id: "t1",
  });
  const parsed = JSON.parse(stdout);
  expect(parsed.hookSpecificOutput.hookEventName).toBe("PostToolUse");
  expect(parsed.hookSpecificOutput.additionalContext).toContain("Planning Guidelines");
});

test("leaves the marker unspent when EnterPlanMode never lands", async () => {
  await run({ hook_event_name: "PreToolUse", permission_mode: "auto", session_id: "t1" });
  const later = await run({ permission_mode: "plan", session_id: "t1" });
  expect(later).not.toBe("");
});

test("re-injects for a different session id", async () => {
  await run({ permission_mode: "plan", session_id: "t1" });
  const stdout = await run({ permission_mode: "plan", session_id: "t2" });
  expect(stdout.length).toBeGreaterThan(0);
});

test("includes delegation guidance when the model is expensive", async () => {
  const transcript_path = await opusTranscript();
  const stdout = await run({ permission_mode: "plan", session_id: "t1", transcript_path });
  const parsed = JSON.parse(stdout);
  expect(parsed.hookSpecificOutput.additionalContext).toContain("# Delegation");
});
