import { describe, expect, test } from "bun:test";
import type { PostToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { processPostToolUse } from "./check-lint";
import type { SkillLintResult } from "./skill-lint/types";

function fakeLintSkill(dir: string): SkillLintResult {
  if (dir.includes("passing")) {
    return {
      path: "",
      errors: 0,
      warnings: 0,
      results: [],
      references: [],
      tokens: { skill: 0, total: 0 },
    };
  }
  return {
    path: "",
    errors: 1,
    warnings: 0,
    results: [
      {
        rule: "name-format",
        severity: "error",
        passed: false,
        message: '"BAD" contains invalid characters',
      },
      { rule: "description-required", severity: "error", passed: true, message: "42 chars" },
    ],
    references: [],
    tokens: { skill: 0, total: 0 },
  };
}

function postToolUseInput(filePath: string) {
  return {
    session_id: "test",
    transcript_path: "/tmp/transcript.jsonl",
    cwd: "/tmp",
    permission_mode: "default" as const,
    hook_event_name: "PostToolUse" as const,
    tool_use_id: "test-id",
    tool_name: "Write" as const,
    tool_input: { file_path: filePath, content: "" },
    tool_response: { message: "ok", bytes_written: 0 },
  };
}

describe("processPostToolUse", () => {
  test.each<{ name: string; input: PostToolUseHookInput; expectLint: boolean }>([
    {
      name: "returns lint issues for SKILL.md writes",
      input: postToolUseInput("/plugins/gitlab/skills/ci/SKILL.md"),
      expectLint: true,
    },
    {
      name: "returns null for passing lint",
      input: postToolUseInput("/passing/skills/ci/SKILL.md"),
      expectLint: false,
    },
    {
      name: "ignores non-SKILL.md files",
      input: postToolUseInput("/plugins/gitlab/skills/ci/scripts/run.ts"),
      expectLint: false,
    },
    {
      name: "ignores non-file tools",
      input: {
        session_id: "test",
        transcript_path: "/tmp/transcript.jsonl",
        cwd: "/tmp",
        permission_mode: "default" as const,
        hook_event_name: "PostToolUse" as const,
        tool_use_id: "test-id",
        tool_name: "Bash" as const,
        tool_input: { command: "ls" },
        tool_response: { output: "", exit_code: 0 },
      },
      expectLint: false,
    },
  ])("$name", async ({ input, expectLint }) => {
    const output = await processPostToolUse(input, fakeLintSkill);
    if (expectLint) {
      expect(output).toMatchObject({
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext: expect.stringContaining("name-format"),
        },
      });
    } else {
      expect(output).toBeNull();
    }
  });
});
