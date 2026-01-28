import { describe, it, expect } from "vitest";
import type { PostToolUseInput } from "@constellos/claude-code-kit";
import {
  extractSkillRoot,
  validateSkillPath,
  processHookInput,
} from "./check-structure";

function mockWriteInput(filePath: string): PostToolUseInput {
  return {
    session_id: "test",
    transcript_path: "/tmp/transcript.jsonl",
    cwd: "/tmp",
    permission_mode: "default",
    hook_event_name: "PostToolUse",
    tool_use_id: "test-id",
    tool_name: "Write",
    tool_input: { file_path: filePath, content: "" },
    tool_response: { message: "ok", bytes_written: 0 },
  };
}

describe("extractSkillRoot", () => {
  it("extracts root from plugin skill paths", () => {
    expect(
      extractSkillRoot("/path/to/plugins/gitlab/skills/ci/SKILL.md"),
    ).toBe("/path/to/plugins/gitlab/skills/ci");
  });

  it("extracts root from personal skill paths", () => {
    expect(
      extractSkillRoot("/Users/ben/.claude/skills/my-skill/SKILL.md"),
    ).toBe("/Users/ben/.claude/skills/my-skill");
  });

  it("extracts root from project skill paths", () => {
    expect(
      extractSkillRoot("/project/.claude/skills/review/scripts/lint.sh"),
    ).toBe("/project/.claude/skills/review");
  });

  it("returns null for non-skill paths", () => {
    expect(extractSkillRoot("/path/to/src/file.ts")).toBeNull();
    expect(extractSkillRoot("/Users/ben/project/README.md")).toBeNull();
  });
});

describe("validateSkillPath", () => {
  const root = "/plugins/gitlab/skills/ci";

  it("allows SKILL.md", () => {
    expect(validateSkillPath(`${root}/SKILL.md`, root)).toBeNull();
  });

  it("allows files in scripts/", () => {
    expect(validateSkillPath(`${root}/scripts/run.sh`, root)).toBeNull();
  });

  it("allows files in references/", () => {
    expect(
      validateSkillPath(`${root}/references/api.md`, root),
    ).toBeNull();
  });

  it("allows files in assets/", () => {
    expect(
      validateSkillPath(`${root}/assets/template.html`, root),
    ).toBeNull();
  });

  it("allows nested files within allowed directories", () => {
    expect(
      validateSkillPath(`${root}/scripts/lib/helpers.ts`, root),
    ).toBeNull();
  });

  it("rejects files in non-standard directories", () => {
    const result = validateSkillPath(`${root}/utils/helper.ts`, root);
    expect(result).toContain("utils/helper.ts");
    expect(result).toContain("outside the standard skill structure");
    expect(result).toContain("agentskills.io");
  });

  it("rejects top-level files other than SKILL.md", () => {
    const result = validateSkillPath(`${root}/README.md`, root);
    expect(result).toContain("README.md");
    expect(result).toContain("outside the standard skill structure");
  });

  it("rejects src/ directory", () => {
    const result = validateSkillPath(`${root}/src/index.ts`, root);
    expect(result).toContain("src/index.ts");
  });
});

describe("processHookInput", () => {
  it("warns on writes to non-standard paths", () => {
    const warnings = processHookInput(
      mockWriteInput("/plugins/gitlab/skills/ci/lib/utils.ts"),
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("outside the standard skill structure");
  });

  it("allows writes to SKILL.md", () => {
    const warnings = processHookInput(
      mockWriteInput("/plugins/gitlab/skills/ci/SKILL.md"),
    );
    expect(warnings).toEqual([]);
  });

  it("allows writes to standard directories", () => {
    expect(
      processHookInput(
        mockWriteInput("/plugins/gitlab/skills/ci/scripts/run.sh"),
      ),
    ).toEqual([]);
    expect(
      processHookInput(
        mockWriteInput("/plugins/gitlab/skills/ci/references/api.md"),
      ),
    ).toEqual([]);
    expect(
      processHookInput(
        mockWriteInput("/plugins/gitlab/skills/ci/assets/logo.png"),
      ),
    ).toEqual([]);
  });

  it("ignores non-skill paths", () => {
    const warnings = processHookInput(
      mockWriteInput("/Users/ben/src/project/utils/helper.ts"),
    );
    expect(warnings).toEqual([]);
  });

  it("ignores non-file tools", () => {
    const input: PostToolUseInput = {
      session_id: "test",
      transcript_path: "/tmp/transcript.jsonl",
      cwd: "/tmp",
      permission_mode: "default",
      hook_event_name: "PostToolUse",
      tool_use_id: "test-id",
      tool_name: "Bash",
      tool_input: { command: "ls" },
      tool_response: { output: "", exit_code: 0 },
    };
    expect(processHookInput(input)).toEqual([]);
  });
});
