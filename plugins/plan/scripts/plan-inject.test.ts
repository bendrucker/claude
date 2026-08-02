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

test("stays silent outside plan mode", async () => {
  const stdout = await run({ permission_mode: "default", session_id: "t1" });
  expect(stdout).toBe("");
});

test("injects on EnterPlanMode, which still carries the pre-switch mode", async () => {
  const stdout = await run({
    permission_mode: "auto",
    tool_name: "EnterPlanMode",
    session_id: "t1",
  });
  const parsed = JSON.parse(stdout);
  expect(parsed.hookSpecificOutput.additionalContext).toContain("Planning Guidelines");
});

test("stays silent on another tool call outside plan mode", async () => {
  const stdout = await run({ permission_mode: "auto", tool_name: "Read", session_id: "t1" });
  expect(stdout).toBe("");
});

test("stays silent without a session_id, since a high-frequency hook cannot dedup", async () => {
  const stdout = await run({ permission_mode: "plan" });
  expect(stdout).toBe("");
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
