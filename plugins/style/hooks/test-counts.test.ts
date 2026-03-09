import { afterEach, describe, expect, it } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  PreToolUseHookInput,
  PreToolUseHookSpecificOutput,
} from "@anthropic-ai/claude-agent-sdk";
import { processInput } from "./test-counts";

function mockWriteInput(
  filePath: string,
  content: string,
  sessionId = "test-session",
): PreToolUseHookInput {
  return {
    hook_event_name: "PreToolUse",
    session_id: sessionId,
    transcript_path: "/tmp/test",
    cwd: "/tmp",
    tool_name: "Write",
    tool_input: { file_path: filePath, content },
    tool_use_id: "test-use-id",
  };
}

function mockEditInput(
  filePath: string,
  newString: string,
  sessionId = "test-session",
): PreToolUseHookInput {
  return {
    hook_event_name: "PreToolUse",
    session_id: sessionId,
    transcript_path: "/tmp/test",
    cwd: "/tmp",
    tool_name: "Edit",
    tool_input: { file_path: filePath, new_string: newString },
    tool_use_id: "test-use-id",
  };
}

function markerPath(sessionId: string, key: string): string {
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 12);
  return join(tmpdir(), `style-counts-${sessionId}-${hash}`);
}

function getContext(result: Awaited<ReturnType<typeof processInput>>): string | undefined {
  const output = result?.hookSpecificOutput as PreToolUseHookSpecificOutput | undefined;
  if (output && "additionalContext" in output) {
    return output.additionalContext;
  }
  return undefined;
}

const markers: string[] = [];
afterEach(() => {
  for (const m of markers) {
    try {
      unlinkSync(m);
    } catch {}
  }
  markers.length = 0;
});

function trackMarker(sessionId: string, key: string) {
  markers.push(markerPath(sessionId, key));
}

describe("processInput", () => {
  it("injects context for markdown Write with digits", async () => {
    const sid = `tc-${randomUUID()}-1`;
    trackMarker(sid, "README.md");
    const result = await processInput(mockWriteInput("README.md", "Added 5 endpoints", sid));
    expect(getContext(result)).toContain("counting");
  });

  it("returns null for markdown Write without digits", async () => {
    const result = await processInput(
      mockWriteInput("README.md", "No numbers here", `tc-${randomUUID()}-2`),
    );
    expect(result).toBeNull();
  });

  it("returns null for non-markdown files", async () => {
    const result = await processInput(
      mockWriteInput("app.ts", "Added 5 tests", `tc-${randomUUID()}-3`),
    );
    expect(result).toBeNull();
  });

  it("injects context for markdown Edit with digits", async () => {
    const sid = `tc-${randomUUID()}-4`;
    trackMarker(sid, "docs.md");
    const result = await processInput(mockEditInput("docs.md", "3 new features", sid));
    expect(getContext(result)).toContain("counting");
  });

  it("skips injection on second call for same file", async () => {
    const sid = `tc-${randomUUID()}-5`;
    trackMarker(sid, "README.md");
    const first = await processInput(mockWriteInput("README.md", "5 items", sid));
    expect(first).not.toBeNull();
    const second = await processInput(mockWriteInput("README.md", "10 items", sid));
    expect(second).toBeNull();
  });

  it("injects again for different session", async () => {
    const sid1 = `tc-${randomUUID()}-6a`;
    const sid2 = `tc-${randomUUID()}-6b`;
    trackMarker(sid1, "README.md");
    trackMarker(sid2, "README.md");
    const first = await processInput(mockWriteInput("README.md", "5 items", sid1));
    expect(first).not.toBeNull();
    const second = await processInput(mockWriteInput("README.md", "5 items", sid2));
    expect(second).not.toBeNull();
  });

  it("injects context for MCP tool with body containing digits", async () => {
    const sid = `tc-${randomUUID()}-7`;
    const input: PreToolUseHookInput = {
      hook_event_name: "PreToolUse",
      session_id: sid,
      transcript_path: "/tmp/test",
      cwd: "/tmp",
      tool_name: "mcp__plugin_github_github__create_pull_request",
      tool_input: {
        body: "Added 5 endpoints\nThis PR introduces new API routes for user management",
      },
      tool_use_id: "mcp-test-id",
    };
    trackMarker(sid, "mcp:mcp-test-id");
    const result = await processInput(input);
    expect(getContext(result)).toContain("counting");
  });

  it("injects context for Bash heredoc with digits", async () => {
    const sid = `tc-${randomUUID()}-9`;
    const input: PreToolUseHookInput = {
      hook_event_name: "PreToolUse",
      session_id: sid,
      transcript_path: "/tmp/test",
      cwd: "/tmp",
      tool_name: "Bash",
      tool_input: {
        command: `gh pr create --body "$(cat <<'EOF'
Added 5 endpoints
New API routes
EOF
)"`,
      },
      tool_use_id: "bash-test-id",
    };
    trackMarker(sid, "bash:bash-test-id");
    const result = await processInput(input);
    expect(getContext(result)).toContain("counting");
  });

  it("returns null for MCP tool with body without digits", async () => {
    const input: PreToolUseHookInput = {
      hook_event_name: "PreToolUse",
      session_id: `tc-${randomUUID()}-8`,
      transcript_path: "/tmp/test",
      cwd: "/tmp",
      tool_name: "mcp__plugin_github_github__create_pull_request",
      tool_input: { body: "No numbers here\nThis PR refactors the authentication module" },
      tool_use_id: "mcp-test-id",
    };
    expect(await processInput(input)).toBeNull();
  });
});
