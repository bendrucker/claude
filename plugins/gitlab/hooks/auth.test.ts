import { describe, expect, it, test } from "bun:test";
import { join } from "node:path";
import { type HookInput, processInput } from "./auth";

function mockInput(command: string, toolResponse: unknown = {}): HookInput {
  return {
    session_id: "test",
    hook_event_name: "PostToolUse",
    tool_name: "Bash",
    tool_input: { command },
    tool_response: toolResponse,
    transcript_path: "/tmp/transcript.json",
    cwd: process.cwd(),
    tool_use_id: "test",
  };
}

describe("glab auth hook", () => {
  it("returns recovery guidance for invalid_grant error", () => {
    const input = mockInput("glab mr view 112", {
      stdout: "",
      stderr: 'oauth2: "invalid_grant" "The provided authorization grant is invalid"',
    });
    const output = processInput(input)?.hookSpecificOutput;
    if (output?.hookEventName !== "PostToolUse") {
      throw new Error(`expected PostToolUse output, got ${JSON.stringify(output)}`);
    }
    expect(output.additionalContext).toContain("glab auth login");
  });

  it("ignores glab commands without auth errors", () => {
    const input = mockInput("glab mr list", { stdout: "No merge requests" });
    expect(processInput(input)).toBeNull();
  });

  it("ignores non-glab commands", () => {
    const input = mockInput("git status", {
      stderr: 'oauth2: "invalid_grant"',
    });
    expect(processInput(input)).toBeNull();
  });

  it("ignores commands with no response", () => {
    const input = mockInput("glab mr view 1");
    expect(processInput(input)).toBeNull();
  });
});

async function runHook(payload: string) {
  const hook = Bun.spawn(["bun", join(import.meta.dir, "auth.ts")], {
    stdin: new TextEncoder().encode(payload),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(hook.stdout).text(),
    new Response(hook.stderr).text(),
    hook.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe("undecodable payload", () => {
  test.each<{ name: string; payload: string }>([
    { name: "not JSON", payload: "not json" },
    { name: "wrong event", payload: JSON.stringify({ hook_event_name: "PreToolUse" }) },
  ])("$name logs and exits 0", async ({ payload }) => {
    const { stdout, stderr, exitCode } = await runHook(payload);
    expect(stderr).toContain("[gitlab/auth] Failed to parse hook input:");
    expect(stdout).toBe("");
    expect(exitCode).toBe(0);
  });
});
