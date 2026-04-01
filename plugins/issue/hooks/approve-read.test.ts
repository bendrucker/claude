import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { rm } from "node:fs/promises";
import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { writeTarget } from "../scripts/target";
import { processInput } from "./approve-read";

const sessionId = `test-approve-read-${Date.now()}`;
const dir = `/tmp/claude/${sessionId}`;

function mockInput(
  owner: string,
  repo: string,
  issueNumber: number,
  method = "get",
): PreToolUseHookInput {
  return {
    hook_event_name: "PreToolUse",
    session_id: sessionId,
    transcript_path: "/tmp/test",
    cwd: "/tmp",
    tool_name: "mcp__plugin_github_github__issue_read",
    tool_input: { owner, repo, issue_number: issueNumber, method },
    tool_use_id: "test",
  };
}

describe("approve-read hook", () => {
  beforeEach(async () => {
    await writeTarget(sessionId, {
      service: "github",
      owner: "acme",
      repo: "widgets",
      number: 123,
    });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("approves matching issue", async () => {
    const result = await processInput(mockInput("acme", "widgets", 123));
    expect(result).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
      },
    });
  });

  it("approves all read methods for matching issue", async () => {
    for (const method of ["get", "get_comments", "get_sub_issues", "get_labels"]) {
      const result = await processInput(mockInput("acme", "widgets", 123, method));
      expect(result).not.toBeNull();
    }
  });

  it("returns null for different issue number", async () => {
    expect(await processInput(mockInput("acme", "widgets", 456))).toBeNull();
  });

  it("returns null for different repo", async () => {
    expect(await processInput(mockInput("acme", "other", 123))).toBeNull();
  });

  it("returns null for different owner", async () => {
    expect(await processInput(mockInput("other", "widgets", 123))).toBeNull();
  });

  it("returns null when no target file exists", async () => {
    await rm(dir, { recursive: true, force: true });
    expect(await processInput(mockInput("acme", "widgets", 123))).toBeNull();
  });
});
