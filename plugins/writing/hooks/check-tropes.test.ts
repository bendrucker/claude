import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  PreToolUseHookInput,
  PreToolUseHookSpecificOutput,
} from "@anthropic-ai/claude-agent-sdk";
import { collectText, processInput } from "./check-tropes";

function mockWrite(content: string): PreToolUseHookInput {
  return {
    hook_event_name: "PreToolUse",
    session_id: "test",
    transcript_path: "/tmp/test",
    cwd: "/tmp",
    tool_name: "Write",
    tool_input: { file_path: "test.md", content },
    tool_use_id: "test",
  };
}

function mockEdit(newString: string): PreToolUseHookInput {
  return {
    hook_event_name: "PreToolUse",
    session_id: "test",
    transcript_path: "/tmp/test",
    cwd: "/tmp",
    tool_name: "Edit",
    tool_input: { file_path: "test.md", new_string: newString },
    tool_use_id: "test",
  };
}

function mockBash(command: string): PreToolUseHookInput {
  return {
    hook_event_name: "PreToolUse",
    session_id: "test",
    transcript_path: "/tmp/test",
    cwd: "/tmp",
    tool_name: "Bash",
    tool_input: { command },
    tool_use_id: "test",
  };
}

function mockMcp(toolName: string, toolInput: Record<string, unknown>): PreToolUseHookInput {
  return {
    hook_event_name: "PreToolUse",
    session_id: "test",
    transcript_path: "/tmp/test",
    cwd: "/tmp",
    tool_name: toolName,
    tool_input: toolInput,
    tool_use_id: "test",
  };
}

async function getDecision(
  input: PreToolUseHookInput,
): Promise<PreToolUseHookSpecificOutput | null> {
  const result = await processInput(input);
  if (!result) return null;
  return result.hookSpecificOutput as PreToolUseHookSpecificOutput;
}

describe("plan files", () => {
  it("skips Write to plan file with spaced em dash", async () => {
    const input = mockWrite("This \u2014 is bad");
    (input.tool_input as Record<string, unknown>).file_path =
      `${process.env.HOME}/.claude/plans/my-plan.md`;
    expect(await processInput(input)).toBeNull();
  });

  it("skips Edit to plan file with spaced em dash", async () => {
    const input = mockEdit("This \u2014 is bad");
    (input.tool_input as Record<string, unknown>).file_path =
      `${process.env.HOME}/.claude/plans/my-plan.md`;
    expect(await processInput(input)).toBeNull();
  });

  it("still denies non-plan files with spaced em dash", async () => {
    const output = await getDecision(mockWrite("This \u2014 is bad"));
    expect(output?.permissionDecision).toBe("deny");
  });
});

describe("Write/Edit", () => {
  it("denies Write with spaced em dash", async () => {
    const output = await getDecision(mockWrite("This \u2014 is bad"));
    expect(output?.permissionDecision).toBe("deny");
  });

  it("asks on Edit with spaced em dash", async () => {
    const output = await getDecision(mockEdit("This \u2014 is bad"));
    expect(output?.permissionDecision).toBe("ask");
  });

  it("returns context for promotional language", async () => {
    const result = await processInput(mockWrite("A groundbreaking approach"));
    expect(result?.hookSpecificOutput).toHaveProperty("additionalContext");
  });

  it("returns null for clean text", async () => {
    expect(await processInput(mockWrite("Clean prose here."))).toBeNull();
  });

  it("returns null for empty content", async () => {
    expect(await processInput(mockWrite(""))).toBeNull();
  });
});

describe("plan files", () => {
  it("skips Write to plan file with spaced em dash", async () => {
    const input = mockWrite("This \u2014 is bad");
    (input.tool_input as Record<string, unknown>).file_path =
      `${process.env.HOME}/.claude/plans/my-plan.md`;
    expect(await processInput(input)).toBeNull();
  });

  it("skips Edit to plan file with spaced em dash", async () => {
    const input = mockEdit("This \u2014 is bad");
    (input.tool_input as Record<string, unknown>).file_path =
      `${process.env.HOME}/.claude/plans/my-plan.md`;
    expect(await processInput(input)).toBeNull();
  });

  it("still denies non-plan files with spaced em dash", async () => {
    const output = await getDecision(mockWrite("This \u2014 is bad"));
    expect(output?.permissionDecision).toBe("deny");
  });
});

describe("collectText", () => {
  describe("Bash commands", () => {
    let dir: string;
    let tmpFile: string;

    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), "trope-test-"));
      tmpFile = join(dir, "body.md");
    });

    afterAll(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it("reads --body-file content", async () => {
      await Bun.write(tmpFile, "Body content here");
      const texts = await collectText(mockBash(`gh pr create --body-file ${tmpFile}`));
      expect(texts).toContain("Body content here");
    });

    it("reads --body-file= content", async () => {
      await Bun.write(tmpFile, "Body content");
      const texts = await collectText(mockBash(`gh pr create --body-file=${tmpFile}`));
      expect(texts).toContain("Body content");
    });

    it("extracts inline --body", async () => {
      const texts = await collectText(mockBash('gh issue create --body "Issue description"'));
      expect(texts).toContain("Issue description");
    });

    it("extracts inline --title", async () => {
      const texts = await collectText(mockBash('gh issue create --title "My title"'));
      expect(texts).toContain("My title");
    });

    it("returns empty for commands without text args", async () => {
      const texts = await collectText(mockBash("git status"));
      expect(texts).toHaveLength(0);
    });
  });

  describe("MCP tools", () => {
    it("extracts prose strings, skipping short values", async () => {
      const texts = await collectText(
        mockMcp("mcp__linear__save_issue", {
          title: "Fix the bug in authentication flow",
          description: "Users are unable to log in when using SSO",
          team: "ENG",
        }),
      );
      expect(texts).toContain("Fix the bug in authentication flow");
      expect(texts).toContain("Users are unable to log in when using SSO");
      expect(texts).not.toContain("ENG");
    });

    it("skips URLs and identifiers", async () => {
      const texts = await collectText(
        mockMcp("mcp__claude_ai_Slack__slack_send_message", {
          channel_id: "C123ABC456",
          text: "The deploy finished successfully and all tests pass",
        }),
      );
      expect(texts).toContain("The deploy finished successfully and all tests pass");
      expect(texts).not.toContain("C123ABC456");
    });

    it("handles empty input", async () => {
      const texts = await collectText(mockMcp("mcp__test", {}));
      expect(texts).toHaveLength(0);
    });
  });
});

describe("Bash/MCP processInput", () => {
  it("denies MCP tool input with spaced em dash", async () => {
    const result = await processInput(
      mockMcp("mcp__linear__save_issue", {
        title: "Fix the bug",
        description: "This feature \u2014 which was added last week \u2014 is broken",
      }),
    );
    expect(result?.hookSpecificOutput).toHaveProperty("permissionDecision", "deny");
  });

  it("denies Bash body-file with AI vocabulary", async () => {
    const dir = mkdtempSync(join(tmpdir(), "trope-test-"));
    const file = join(dir, "body.md");
    await Bun.write(file, "We must delve into the issue");
    const result = await processInput(mockBash(`gh pr create --body-file ${file}`));
    await rm(dir, { recursive: true, force: true });
    expect(result?.hookSpecificOutput).toHaveProperty("permissionDecision", "deny");
  });

  it("returns null for clean MCP input", async () => {
    const result = await processInput(
      mockMcp("mcp__claude_ai_Slack__slack_send_message", {
        text: "The deploy finished successfully.",
      }),
    );
    expect(result).toBeNull();
  });

  it("returns null for non-text Bash commands", async () => {
    expect(await processInput(mockBash("git push origin main"))).toBeNull();
  });
});
