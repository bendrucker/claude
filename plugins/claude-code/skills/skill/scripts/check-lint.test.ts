import { describe, expect, test } from "bun:test";
import type { HookInput } from "./hook-input";
import { makePostToolUseInput } from "./test-support";
import { processPostToolUse } from "./check-lint";
import type { SkillLintResult } from "./skill-lint/types";

function fakeLintSkill(dir: string): SkillLintResult {
  if (dir.includes("no-skill")) throw new Error("SKILL.md not found");
  if (dir.includes("passing")) {
    return {
      path: dir,
      errors: 0,
      warnings: 0,
      results: [],
      references: [],
      tokens: { skill: 0, total: 0 },
    };
  }
  return {
    path: dir,
    errors: 1,
    warnings: 1,
    results: [
      {
        rule: "name-format",
        severity: "error",
        passed: false,
        message: '"BAD" contains invalid characters',
      },
      { rule: "description-required", severity: "error", passed: true, message: "42 chars" },
      {
        rule: "reference-substitution",
        severity: "warn",
        passed: false,
        message: `linted ${dir}`,
        reference: "references/workflows.md",
      },
    ],
    references: [],
    tokens: { skill: 0, total: 0 },
  };
}

function postToolUseInput(filePath: string): HookInput {
  return makePostToolUseInput({ tool_input: { file_path: filePath, content: "" } });
}

describe("processPostToolUse", () => {
  test.each<{ name: string; input: HookInput; contains: string[] }>([
    {
      name: "returns lint issues for SKILL.md writes",
      input: postToolUseInput("/plugins/gitlab/skills/ci/SKILL.md"),
      contains: ["name-format"],
    },
    {
      name: "lints the owning skill for references/ writes",
      input: postToolUseInput("/plugins/gitlab/skills/ci/references/workflows.md"),
      contains: [
        "reference-substitution (references/workflows.md)",
        "linted /plugins/gitlab/skills/ci",
      ],
    },
    {
      name: "returns null for passing lint",
      input: postToolUseInput("/passing/skills/ci/SKILL.md"),
      contains: [],
    },
    {
      name: "returns null for a references/ directory with no skill above it",
      input: postToolUseInput("/docs/no-skill/references/notes.md"),
      contains: [],
    },
    {
      name: "ignores other files inside a skill",
      input: postToolUseInput("/plugins/gitlab/skills/ci/scripts/run.ts"),
      contains: [],
    },
    {
      name: "ignores non-file tools",
      input: makePostToolUseInput({ tool_name: "Bash", tool_input: { command: "ls" } }),
      contains: [],
    },
  ])("$name", async ({ input, contains }) => {
    const output = await processPostToolUse(input, fakeLintSkill);
    if (contains.length === 0) {
      expect(output).toBeNull();
      return;
    }

    const specific = output?.hookSpecificOutput;
    const context = specific?.hookEventName === "PostToolUse" ? specific.additionalContext : "";
    for (const text of contains) expect(context).toContain(text);
  });
});
