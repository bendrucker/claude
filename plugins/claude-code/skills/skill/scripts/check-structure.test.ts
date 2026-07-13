import { describe, expect, it, test } from "bun:test";
import type { PostToolUseInput } from "@constellos/claude-code-kit";
import { extractSkillRoot, processHookInput, validateSkillPath } from "./check-structure";
import { makePostToolUseInput } from "./test-support";

function mockWriteInput(filePath: string): PostToolUseInput {
  return makePostToolUseInput({ tool_input: { file_path: filePath, content: "" } });
}

test.each<[string, string | null]>([
  ["/path/to/plugins/gitlab/skills/ci/SKILL.md", "/path/to/plugins/gitlab/skills/ci"],
  ["/Users/ben/.claude/skills/my-skill/SKILL.md", "/Users/ben/.claude/skills/my-skill"],
  ["/project/.claude/skills/review/scripts/lint.sh", "/project/.claude/skills/review"],
  ["/path/to/src/file.ts", null],
  ["/Users/ben/project/README.md", null],
])("extractSkillRoot(%p) -> %p", (path, expected) => {
  expect(extractSkillRoot(path)).toBe(expected);
});

describe("validateSkillPath", () => {
  const root = "/plugins/gitlab/skills/ci";

  test.each<{ name: string; path: string; substrings: string[] }>([
    { name: "allows SKILL.md", path: `${root}/SKILL.md`, substrings: [] },
    { name: "allows files in scripts/", path: `${root}/scripts/run.sh`, substrings: [] },
    { name: "allows files in references/", path: `${root}/references/api.md`, substrings: [] },
    { name: "allows files in assets/", path: `${root}/assets/template.html`, substrings: [] },
    {
      name: "allows nested files within allowed directories",
      path: `${root}/scripts/lib/helpers.ts`,
      substrings: [],
    },
    {
      name: "rejects files in non-standard directories",
      path: `${root}/utils/helper.ts`,
      substrings: ["utils/helper.ts", "outside the standard skill structure", "agentskills.io"],
    },
    {
      name: "rejects top-level files other than SKILL.md",
      path: `${root}/README.md`,
      substrings: ["README.md", "outside the standard skill structure"],
    },
    {
      name: "rejects src/ directory",
      path: `${root}/src/index.ts`,
      substrings: ["src/index.ts"],
    },
  ])("$name", ({ path, substrings }) => {
    const result = validateSkillPath(path, root);
    if (substrings.length === 0) {
      expect(result).toBeNull();
    } else {
      for (const substring of substrings) {
        expect(result).toContain(substring);
      }
    }
  });
});

describe("processHookInput", () => {
  it("warns on writes to non-standard paths", () => {
    const warnings = processHookInput(mockWriteInput("/plugins/gitlab/skills/ci/lib/utils.ts"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("outside the standard skill structure");
  });

  it("allows writes to SKILL.md", () => {
    const warnings = processHookInput(mockWriteInput("/plugins/gitlab/skills/ci/SKILL.md"));
    expect(warnings).toEqual([]);
  });

  it("allows writes to standard directories", () => {
    expect(processHookInput(mockWriteInput("/plugins/gitlab/skills/ci/scripts/run.sh"))).toEqual(
      [],
    );
    expect(processHookInput(mockWriteInput("/plugins/gitlab/skills/ci/references/api.md"))).toEqual(
      [],
    );
    expect(processHookInput(mockWriteInput("/plugins/gitlab/skills/ci/assets/logo.png"))).toEqual(
      [],
    );
  });

  it("ignores non-skill paths", () => {
    const warnings = processHookInput(mockWriteInput("/Users/ben/src/project/utils/helper.ts"));
    expect(warnings).toEqual([]);
  });

  it("ignores non-file tools", () => {
    const input = makePostToolUseInput({
      tool_name: "Bash",
      tool_input: { command: "ls" },
      tool_response: { output: "", exit_code: 0 },
    });
    expect(processHookInput(input)).toEqual([]);
  });
});
