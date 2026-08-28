import { describe, expect, test } from "bun:test";
import type { HookInput } from "./hook-input";
import { makePostToolUseInput } from "./test-support";
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

function postToolUseInput(filePath: string): HookInput {
  return makePostToolUseInput({ tool_input: { file_path: filePath, content: "" } });
}

describe("processPostToolUse", () => {
  test.each<{ name: string; input: HookInput; expectLint: boolean }>([
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
      input: makePostToolUseInput({ tool_name: "Bash", tool_input: { command: "ls" } }),
      expectLint: false,
    },
  ])("$name", async ({ input, expectLint }) => {
    const output = await processPostToolUse(input, fakeLintSkill);
    if (!expectLint) {
      expect(output).toBeNull();
      return;
    }

    const specific = output?.hookSpecificOutput;
    expect(specific?.hookEventName === "PostToolUse" ? specific.additionalContext : "").toContain(
      "name-format",
    );
  });
});
