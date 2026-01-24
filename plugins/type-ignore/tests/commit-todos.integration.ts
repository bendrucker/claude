import type { PostToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import { formatOutput, processInput } from "../hooks/commit-todos";

function mockPostToolUseInput(
  toolName: string,
  toolInput: Record<string, unknown>,
): PostToolUseHookInput {
  return {
    session_id: "test-session",
    hook_event_name: "PostToolUse",
    tool_name: toolName,
    tool_input: toolInput,
    tool_response: {},
    transcript_path: "/tmp/transcript.json",
    cwd: process.cwd(),
    tool_use_id: "test",
  };
}

describe("commit-todos hook", () => {
  describe("processInput", () => {
    it("returns null for non-Bash tools", () => {
      const input = mockPostToolUseInput("Edit", {
        file_path: "/path/to/file.ts",
        old_string: "a",
        new_string: "b",
      });

      const result = processInput(input, undefined);
      expect(result).toBeNull();
    });

    it("returns null for non-commit Bash commands", () => {
      const input = mockPostToolUseInput("Bash", { command: "git status" });

      const result = processInput(input, { stdout: "", stderr: "", exitCode: 0 });
      expect(result).toBeNull();
    });

    it("returns null when commit fails", () => {
      const input = mockPostToolUseInput("Bash", { command: "git commit -m 'test'" });

      const result = processInput(input, { stdout: "", stderr: "error", exitCode: 1 });
      expect(result).toBeNull();
    });

    it("recognizes git commit commands", () => {
      const commands = [
        "git commit -m 'test'",
        'git commit -m "test"',
        "git commit --amend",
        "git add . && git commit -m 'test'",
      ];

      for (const command of commands) {
        const input = mockPostToolUseInput("Bash", { command });

        const result = processInput(input, { stdout: "", stderr: "", exitCode: 0 });
        expect(result).toBeNull();
      }
    });
  });

  describe("formatOutput", () => {
    it("formats TODO list with file, line, tag, and text", () => {
      const todos = [
        { file: "src/foo.ts", line: 42, tag: "TODO", text: "Fix this" },
        { file: "src/bar.ts", line: 10, tag: "FIXME", text: "Broken" },
      ];

      const result = formatOutput(todos);

      expect(result.hookSpecificOutput?.hookEventName).toBe("PostToolUse");
      const additionalContext = (result.hookSpecificOutput as { additionalContext: string })
        .additionalContext;
      expect(additionalContext).toContain("src/foo.ts:42");
      expect(additionalContext).toContain("TODO: Fix this");
      expect(additionalContext).toContain("src/bar.ts:10");
      expect(additionalContext).toContain("FIXME: Broken");
      expect(additionalContext).toContain("Consider addressing these before creating a PR");
    });
  });
});
