import { describe, expect, it, test } from "bun:test";
import { join } from "node:path";
import { type HookInput, processInput } from "./auth";

function mockFailure(command: string, error: string): HookInput {
  return {
    session_id: "test",
    hook_event_name: "PostToolUseFailure",
    tool_name: "Bash",
    tool_input: { command },
    error,
    transcript_path: "/tmp/transcript.json",
    cwd: process.cwd(),
    tool_use_id: "test",
  };
}

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

  test.each<{ name: string; stderr: string }>([
    {
      name: "no token",
      stderr: "OAuth2 is configured for gitlab.com but no access or refresh token was found",
    },
    { name: "401", stderr: "GET https://gitlab.com/api/v4/user: 401 {message: 401 Unauthorized}" },
  ])("recognizes $name wording", ({ stderr }) => {
    const output = processInput(mockInput("glab api user", { stdout: "", stderr }));
    expect(output?.hookSpecificOutput).toMatchObject({ hookEventName: "PostToolUse" });
  });

  it("reads the error of a failed call", () => {
    const output = processInput(
      mockFailure("glab mr view 1", "Exit code 1\n401 Unauthorized"),
    )?.hookSpecificOutput;
    if (output?.hookEventName !== "PostToolUseFailure") {
      throw new Error(`expected PostToolUseFailure output, got ${JSON.stringify(output)}`);
    }
    expect(output.additionalContext).toContain("glab auth login");
  });

  it("leaves 403 alone", () => {
    expect(processInput(mockFailure("glab mr view 1", "403 Forbidden"))).toBeNull();
  });

  test.each<{ name: string; stderr: string }>([
    { name: "a warning on stderr", stderr: "warning: slow" },
    { name: "an empty stderr", stderr: "" },
  ])("ignores a stdout that only prints the wording, with $name", ({ stderr }) => {
    const input = mockInput("glab ci trace 5", {
      stdout: "job log: 401 Unauthorized from the registry",
      stderr,
    });
    expect(processInput(input)).toBeNull();
  });

  test.each<{ name: string; command: string }>([
    { name: "a command that only names glab", command: "grep invalid_grant glab-notes.txt" },
    { name: "a heredoc that mentions glab", command: "cat <<'EOF'\nglab auth\nEOF" },
    { name: "a query over glab output", command: "duckdb -c \"select 'glab invalid_grant'\"" },
  ])("ignores $name", ({ command }) => {
    expect(processInput(mockFailure(command, 'oauth2: "invalid_grant"'))).toBeNull();
    expect(processInput(mockInput(command, { stderr: "invalid_grant" }))).toBeNull();
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
