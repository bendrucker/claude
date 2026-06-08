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

function mockEdit(newString: string, oldString?: string): PreToolUseHookInput {
  const toolInput: Record<string, unknown> = {
    file_path: "test.md",
    new_string: newString,
  };
  if (oldString !== undefined) toolInput.old_string = oldString;
  return {
    hook_event_name: "PreToolUse",
    session_id: "test",
    transcript_path: "/tmp/test",
    cwd: "/tmp",
    tool_name: "Edit",
    tool_input: toolInput,
    tool_use_id: "test",
  };
}

function mockMultiEdit(
  edits: Array<{ old_string?: string; new_string: string }>,
): PreToolUseHookInput {
  return {
    hook_event_name: "PreToolUse",
    session_id: "test",
    transcript_path: "/tmp/test",
    cwd: "/tmp",
    tool_name: "MultiEdit",
    tool_input: { file_path: "test.md", edits },
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

  it("returns reminder for non-plan files with spaced em dash", async () => {
    const result = await processInput(mockWrite("This \u2014 is bad"));
    expect(result?.hookSpecificOutput).toHaveProperty("additionalContext");
  });
});

describe("memory files", () => {
  const memoryPath = `${process.env.HOME}/.claude/projects/-Users-ben-test/memory/MEMORY.md`;

  it("skips Write to memory file with spaced em dash", async () => {
    const input = mockWrite("This \u2014 is bad");
    (input.tool_input as Record<string, unknown>).file_path = memoryPath;
    expect(await processInput(input)).toBeNull();
  });

  it("skips Edit to memory file with spaced em dash", async () => {
    const input = mockEdit("This \u2014 is bad");
    (input.tool_input as Record<string, unknown>).file_path = memoryPath;
    expect(await processInput(input)).toBeNull();
  });
});

describe("wordlist files", () => {
  it("skips Write to wordlist file containing flagged vocabulary", async () => {
    const input = mockWrite("delve\ntapestry\nbolstered\n");
    (input.tool_input as Record<string, unknown>).file_path =
      "/Users/test/plugins/writing/wordlists/vocabulary.txt";
    expect(await processInput(input)).toBeNull();
  });

  it("skips Edit to wordlist file", async () => {
    const input = mockEdit("delve\nadded entry\n");
    (input.tool_input as Record<string, unknown>).file_path =
      "/Users/test/plugins/writing/wordlists/vocabulary.txt";
    expect(await processInput(input)).toBeNull();
  });

  it("does not skip non-wordlist .txt files", async () => {
    const input = mockWrite("delve into the data is the way forward.");
    (input.tool_input as Record<string, unknown>).file_path = "/tmp/notes.txt";
    const result = await processInput(input);
    expect(result?.hookSpecificOutput).toHaveProperty("additionalContext");
  });
});

describe("semicolon file scoping", () => {
  const semicolonText = "First point; second point; third point; fourth";

  it("flags semicolons in markdown files", async () => {
    const input = mockWrite(semicolonText);
    const result = await processInput(input);
    expect(result?.hookSpecificOutput).toHaveProperty("additionalContext");
  });

  it("skips semicolons in shell scripts", async () => {
    const input = mockWrite(semicolonText);
    (input.tool_input as Record<string, unknown>).file_path = "deploy.sh";
    expect(await processInput(input)).toBeNull();
  });

  it("skips semicolons in TypeScript files", async () => {
    const input = mockWrite(semicolonText);
    (input.tool_input as Record<string, unknown>).file_path = "index.ts";
    expect(await processInput(input)).toBeNull();
  });
});

describe("Write/Edit", () => {
  it("returns reminder for Write with spaced em dash", async () => {
    const result = await processInput(mockWrite("This \u2014 is bad"));
    expect(result?.hookSpecificOutput).toHaveProperty("additionalContext");
    const ctx = (result?.hookSpecificOutput as { additionalContext: string }).additionalContext;
    expect(ctx).toContain("follow-up Edit");
  });

  it("returns reminder for Edit with spaced em dash", async () => {
    const result = await processInput(mockEdit("This \u2014 is bad"));
    expect(result?.hookSpecificOutput).toHaveProperty("additionalContext");
  });

  it("ignores flagged content in Edit old_string", async () => {
    const input = mockEdit(
      "clean replacement text here",
      "old content with \u2014 spaced em dash inside",
    );
    expect(await processInput(input)).toBeNull();
  });

  it("returns reminder when old_string is clean but new_string has em dash", async () => {
    const input = mockEdit("This \u2014 is bad", "clean original text here");
    const result = await processInput(input);
    expect(result?.hookSpecificOutput).toHaveProperty("additionalContext");
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

describe("diff-aware filtering", () => {
  it("ignores Edit that preserves a pre-existing em dash", async () => {
    const input = mockEdit(
      "Title \u2014 kept verbatim, with extra detail added.",
      "Title \u2014 kept verbatim.",
    );
    expect(await processInput(input)).toBeNull();
  });

  it("flags Edit that adds a second em dash beyond what old_string had", async () => {
    const input = mockEdit(
      "Title \u2014 kept, and now another \u2014 added phrase.",
      "Title \u2014 kept verbatim.",
    );
    const result = await processInput(input);
    expect(result?.hookSpecificOutput).toHaveProperty("additionalContext");
  });

  it("ignores MultiEdit that preserves pre-existing AI vocabulary", async () => {
    const input = mockMultiEdit([
      {
        old_string: "We delve into the intricacies of the system.",
        new_string: "We delve into the intricacies of the new system, with examples.",
      },
    ]);
    expect(await processInput(input)).toBeNull();
  });

  it("ignores Write that preserves an em dash already in the file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "trope-diff-"));
    const file = join(dir, "doc.md");
    await Bun.write(file, "Title \u2014 already here in the existing file.\n");
    const input = mockWrite("Title \u2014 already here in the existing file.\nAdded line.\n");
    (input.tool_input as Record<string, unknown>).file_path = file;
    const result = await processInput(input);
    await rm(dir, { recursive: true, force: true });
    expect(result).toBeNull();
  });

  it("flags Write that adds a new em dash beyond what file had", async () => {
    const dir = mkdtempSync(join(tmpdir(), "trope-diff-"));
    const file = join(dir, "doc.md");
    await Bun.write(file, "Title \u2014 already here.\n");
    const input = mockWrite("Title \u2014 already here.\nNow another \u2014 line.\n");
    (input.tool_input as Record<string, unknown>).file_path = file;
    const result = await processInput(input);
    await rm(dir, { recursive: true, force: true });
    expect(result?.hookSpecificOutput).toHaveProperty("additionalContext");
  });

  it("skips sycophantic opener in file Edit (sideEffectOnly)", async () => {
    const input = mockEdit("Excellent. Let me proceed.\nNext line.", "Next line.");
    expect(await processInput(input)).toBeNull();
  });
});

describe("MultiEdit", () => {
  it("returns null when all old_string values are flagged but new_string values are clean", async () => {
    const input = mockMultiEdit([
      { old_string: "text with \u2014 em dash", new_string: "clean replacement text here" },
      { old_string: "delve into the codebase", new_string: "look at the code carefully" },
    ]);
    expect(await processInput(input)).toBeNull();
  });

  it("returns reminder when any new_string contains a spaced em dash", async () => {
    const input = mockMultiEdit([
      { old_string: "clean original text here", new_string: "clean replacement text here" },
      { old_string: "more clean original content", new_string: "bad \u2014 replacement here" },
    ]);
    const result = await processInput(input);
    expect(result?.hookSpecificOutput).toHaveProperty("additionalContext");
  });

  it("returns null for fully clean MultiEdit", async () => {
    const input = mockMultiEdit([
      { old_string: "original content here", new_string: "replacement content here" },
    ]);
    expect(await processInput(input)).toBeNull();
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

  it("denies a spaced em dash even on a non-prose tool", async () => {
    const result = await processInput(
      mockMcp("mcp__db__execute", {
        statement: "Filter the rows \u2014 the pending ones \u2014 before the update runs",
      }),
    );
    expect(result?.hookSpecificOutput).toHaveProperty("permissionDecision", "deny");
  });

  it("flags Bash body-file with AI vocabulary as context", async () => {
    const dir = mkdtempSync(join(tmpdir(), "trope-test-"));
    const file = join(dir, "body.md");
    await Bun.write(file, "We must delve into the issue");
    const result = await processInput(mockBash(`gh pr create --body-file ${file}`));
    await rm(dir, { recursive: true, force: true });
    expect(result?.hookSpecificOutput).toHaveProperty("additionalContext");
    expect(result?.hookSpecificOutput).not.toHaveProperty("permissionDecision");
  });

  it("does not deny Bash commands containing flagged tokens as literals", async () => {
    const result = await processInput(mockBash('gh pr create --title "Rename underscore field"'));
    if (result) {
      expect(result.hookSpecificOutput).not.toHaveProperty("permissionDecision");
    }
  });

  it("flags AI vocabulary on a prose-bearing tool as context", async () => {
    const result = await processInput(
      mockMcp("mcp__linear__save_issue", {
        title: "Login fails",
        summary: "We delve into the intricacies of the auth flow here",
      }),
    );
    expect(result?.hookSpecificOutput).toHaveProperty("additionalContext");
    expect(result?.hookSpecificOutput).not.toHaveProperty("permissionDecision");
  });

  it("ignores AI vocabulary on a non-prose tool with a non-prose key", async () => {
    const result = await processInput(
      mockMcp("mcp__db__execute", {
        statement: "We delve into the rows and underscore the totals here",
      }),
    );
    expect(result).toBeNull();
  });

  it("flags AI vocabulary on a non-prose tool with a prose key", async () => {
    const result = await processInput(
      mockMcp("mcp__db__execute", {
        description: "We delve into the rows and underscore the totals here",
      }),
    );
    expect(result?.hookSpecificOutput).toHaveProperty("additionalContext");
    expect(result?.hookSpecificOutput).not.toHaveProperty("permissionDecision");
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

  it("ignores flagged content in nested old_str fields", async () => {
    const flagged = "text with; semicolons; everywhere; really; lots of them";
    const result = await processInput(
      mockMcp("mcp__example_tool", {
        command: "update_content",
        content_updates: [{ old_str: flagged, new_str: "Clean replacement text here." }],
      }),
    );
    expect(result).toBeNull();
  });

  it("ignores blocklisted query fields but scans remaining prose", async () => {
    const result = await processInput(
      mockMcp("mcp__search_tool", {
        query: "delve into the codebase and find issues",
        result_description: "A straightforward summary of the findings.",
      }),
    );
    expect(result).toBeNull();
  });

  it("still flags nested prose in non-blocklisted keys", async () => {
    const result = await processInput(
      mockMcp("mcp__some_tool", {
        payload: { body: "We delve into the system for a while longer" },
      }),
    );
    expect(result?.hookSpecificOutput).toHaveProperty("additionalContext");
    expect(result?.hookSpecificOutput).not.toHaveProperty("permissionDecision");
  });
});
