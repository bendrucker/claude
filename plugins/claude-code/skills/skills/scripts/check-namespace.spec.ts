import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PostToolUseInput } from "@constellos/claude-code-kit";
import {
  extractPluginName,
  getResourceType,
  getResourceName,
  checkStuttering,
  processHookInput,
} from "./check-namespace";

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

describe("extractPluginName", () => {
  it("extracts plugin name from path", () => {
    expect(extractPluginName("/path/to/plugins/gitlab/skills/ci/SKILL.md")).toBe("gitlab");
    expect(extractPluginName("/plugins/claude-code/agents/foo.md")).toBe("claude-code");
  });

  it("returns null for non-plugin paths", () => {
    expect(extractPluginName("/path/to/src/file.ts")).toBeNull();
    expect(extractPluginName("/Users/ben/project/SKILL.md")).toBeNull();
  });
});

describe("getResourceType", () => {
  it("identifies agents", () => {
    expect(getResourceType("/plugins/gitlab/agents/reviewer.md")).toBe("agent");
  });

  it("identifies commands", () => {
    expect(getResourceType("/plugins/gitlab/commands/merge.md")).toBe("command");
  });

  it("defaults to skill", () => {
    expect(getResourceType("/plugins/gitlab/skills/ci/SKILL.md")).toBe("skill");
    expect(getResourceType("/plugins/gitlab/foo.md")).toBe("skill");
  });
});

describe("getResourceName", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "namespace-test-"));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("extracts name from agent filename", () => {
    expect(getResourceName("/plugins/gitlab/agents/reviewer.md", "agent")).toBe("reviewer");
    expect(getResourceName("/plugins/gitlab/agents/gitlab-reviewer.md", "agent")).toBe(
      "gitlab-reviewer",
    );
  });

  it("extracts name from command filename", () => {
    expect(getResourceName("/plugins/gitlab/commands/merge.md", "command")).toBe("merge");
  });

  it("extracts name from skill frontmatter", () => {
    const skillPath = join(testDir, "SKILL.md");
    writeFileSync(skillPath, "---\nname: ci-monitor\ndescription: foo\n---\n");
    expect(getResourceName(skillPath, "skill")).toBe("ci-monitor");
  });

  it("returns null for missing file", () => {
    expect(getResourceName("/nonexistent/SKILL.md", "skill")).toBeNull();
  });
});

describe("checkStuttering", () => {
  it("detects prefix stuttering", () => {
    expect(checkStuttering("gitlab-ci", "gitlab")).toContain("stutters");
    expect(checkStuttering("github-actions", "github")).toContain("stutters");
  });

  it("detects suffix stuttering", () => {
    expect(checkStuttering("ci-gitlab", "gitlab")).toContain("stutters");
  });

  it("detects exact match", () => {
    expect(checkStuttering("gitlab", "gitlab")).toContain("stutters");
  });

  it("handles hyphenated plugin names", () => {
    expect(checkStuttering("claude-code-helper", "claude-code")).toContain("stutters");
    expect(checkStuttering("claude_code_helper", "claude-code")).toContain("stutters");
  });

  it("allows proper names", () => {
    expect(checkStuttering("ci", "gitlab")).toBeNull();
    expect(checkStuttering("actions", "github")).toBeNull();
    expect(checkStuttering("hooks", "claude-code")).toBeNull();
  });
});

describe("processHookInput", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "namespace-test-"));
    mkdirSync(join(testDir, "plugins/gitlab/skills/ci"), { recursive: true });
    mkdirSync(join(testDir, "plugins/gitlab/agents"), { recursive: true });
    mkdirSync(join(testDir, "plugins/gitlab/commands"), { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("warns on stuttering skill name", () => {
    const skillPath = join(testDir, "plugins/gitlab/skills/ci/SKILL.md");
    writeFileSync(skillPath, "name: gitlab-ci\n");

    const warnings = processHookInput(mockWriteInput(skillPath));
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain("Warning");
    expect(warnings[0]).toContain("skill name");
  });

  it("warns on stuttering agent name", () => {
    const agentPath = join(testDir, "plugins/gitlab/agents/gitlab-reviewer.md");
    writeFileSync(agentPath, "---\n");

    const warnings = processHookInput(mockWriteInput(agentPath));
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain("agent name");
  });

  it("warns on stuttering command name", () => {
    const cmdPath = join(testDir, "plugins/gitlab/commands/gitlab-merge.md");
    writeFileSync(cmdPath, "---\n");

    const warnings = processHookInput(mockWriteInput(cmdPath));
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain("command name");
  });

  it("returns empty for proper names", () => {
    const skillPath = join(testDir, "plugins/gitlab/skills/ci/SKILL.md");
    writeFileSync(skillPath, "name: ci\n");

    const warnings = processHookInput(mockWriteInput(skillPath));
    expect(warnings).toEqual([]);
  });

  it("returns empty for non-plugin paths", () => {
    const warnings = processHookInput(mockWriteInput("/Users/ben/src/project/SKILL.md"));
    expect(warnings).toEqual([]);
  });

  it("returns empty for non-file tools", () => {
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
    const warnings = processHookInput(input);
    expect(warnings).toEqual([]);
  });
});
