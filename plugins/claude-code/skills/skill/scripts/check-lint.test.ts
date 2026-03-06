import { describe, expect, it, mock } from "bun:test";

mock.module("./skill-lint", () => ({
  lintSkill: (dir: string) => {
    if (dir.includes("passing")) {
      return { errors: 0, warnings: 0, results: [] };
    }
    return {
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
    };
  },
}));

const { processPostToolUse } = await import("./check-lint");

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
  it("returns lint issues for SKILL.md writes", () => {
    const output = processPostToolUse(postToolUseInput("/plugins/gitlab/skills/ci/SKILL.md"));
    expect(output).toMatchObject({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: expect.stringContaining("name-format"),
      },
    });
  });

  it("returns null for passing lint", () => {
    const output = processPostToolUse(postToolUseInput("/passing/skills/ci/SKILL.md"));
    expect(output).toBeNull();
  });

  it("ignores non-SKILL.md files", () => {
    const output = processPostToolUse(postToolUseInput("/plugins/gitlab/skills/ci/scripts/run.ts"));
    expect(output).toBeNull();
  });

  it("ignores non-file tools", () => {
    const output = processPostToolUse({
      session_id: "test",
      transcript_path: "/tmp/transcript.jsonl",
      cwd: "/tmp",
      permission_mode: "default" as const,
      hook_event_name: "PostToolUse" as const,
      tool_use_id: "test-id",
      tool_name: "Bash" as const,
      tool_input: { command: "ls" },
      tool_response: { output: "", exit_code: 0 },
    });
    expect(output).toBeNull();
  });
});
