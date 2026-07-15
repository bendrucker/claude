import { afterEach, beforeEach, describe, expect, it, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PostToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import {
  checkSkillNamespace,
  checkStuttering,
  extractPluginName,
  getResourceName,
  getResourceType,
  processHookInput,
} from "./check-namespace";
import { makePostToolUseInput } from "./test-support";

function mockWriteInput(filePath: string): PostToolUseHookInput {
  return makePostToolUseInput({ tool_input: { file_path: filePath, content: "" } });
}

test.each<[string, string | null]>([
  ["/path/to/plugins/gitlab/skills/ci/SKILL.md", "gitlab"],
  ["/plugins/claude-code/agents/foo.md", "claude-code"],
  ["/path/to/src/file.ts", null],
  ["/Users/ben/project/SKILL.md", null],
])("extractPluginName(%p) -> %p", (path, expected) => {
  expect(extractPluginName(path)).toBe(expected);
});

test.each<[string, "agent" | "command" | "skill"]>([
  ["/plugins/gitlab/agents/reviewer.md", "agent"],
  ["/plugins/gitlab/commands/merge.md", "command"],
  ["/plugins/gitlab/skills/ci/SKILL.md", "skill"],
  ["/plugins/gitlab/foo.md", "skill"],
])("getResourceType(%p) -> %p", (path, expected) => {
  expect(getResourceType(path)).toBe(expected);
});

describe("getResourceName", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "namespace-test-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("extracts name from agent filename", async () => {
    expect(await getResourceName("/plugins/gitlab/agents/reviewer.md", "agent")).toBe("reviewer");
    expect(await getResourceName("/plugins/gitlab/agents/gitlab-reviewer.md", "agent")).toBe(
      "gitlab-reviewer",
    );
  });

  it("extracts name from command filename", async () => {
    expect(await getResourceName("/plugins/gitlab/commands/merge.md", "command")).toBe("merge");
  });

  it("extracts name from skill frontmatter", async () => {
    const skillPath = join(testDir, "SKILL.md");
    await Bun.write(skillPath, "---\nname: ci-monitor\ndescription: foo\n---\n");
    expect(await getResourceName(skillPath, "skill")).toBe("ci-monitor");
  });

  it("returns null for missing file", async () => {
    expect(await getResourceName("/nonexistent/SKILL.md", "skill")).toBeNull();
  });
});

test.each<[string, string, string | null]>([
  ["gitlab-ci", "gitlab", "stutters"],
  ["github-actions", "github", "stutters"],
  ["ci-gitlab", "gitlab", "stutters"],
  ["gitlab", "gitlab", "stutters"],
  ["claude-code-helper", "claude-code", "stutters"],
  ["claude_code_helper", "claude-code", "stutters"],
  ["ci", "gitlab", null],
  ["actions", "github", null],
  ["hooks", "claude-code", null],
])("checkStuttering(%p, %p) -> %p", (name, plugin, expected) => {
  if (expected === null) {
    expect(checkStuttering(name, plugin)).toBeNull();
  } else {
    expect(checkStuttering(name, plugin)).toContain(expected);
  }
});

test.each<{ name: string; skillName: string; plugin: string; substrings: string[] }>([
  {
    name: "allows name matching plugin name (primary skill)",
    skillName: "git",
    plugin: "git",
    substrings: [],
  },
  {
    name: "allows properly prefixed names (gitlab:ci)",
    skillName: "gitlab:ci",
    plugin: "gitlab",
    substrings: [],
  },
  {
    name: "allows properly prefixed names (claude-code:hook)",
    skillName: "claude-code:hook",
    plugin: "claude-code",
    substrings: [],
  },
  {
    name: "allows plugin:plugin (primary skill with prefix)",
    skillName: "git:git",
    plugin: "git",
    substrings: [],
  },
  {
    name: "warns on missing prefix",
    skillName: "ci",
    plugin: "gitlab",
    substrings: ["should be prefixed", "gitlab:ci"],
  },
  {
    name: "detects stuttering after prefix",
    skillName: "gitlab:gitlab-ci",
    plugin: "gitlab",
    substrings: ["stutters"],
  },
  {
    name: "allows plugin:plugin without stuttering warning",
    skillName: "gitlab:gitlab",
    plugin: "gitlab",
    substrings: [],
  },
])("checkSkillNamespace: $name", ({ skillName, plugin, substrings }) => {
  const warnings = checkSkillNamespace(skillName, plugin);
  if (substrings.length === 0) {
    expect(warnings).toEqual([]);
  } else {
    substrings.forEach((substring, i) => {
      expect(warnings[i]).toContain(substring);
    });
  }
});

describe("processHookInput", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "namespace-test-"));
    mkdirSync(join(testDir, "plugins/gitlab/skills/ci"), { recursive: true });
    mkdirSync(join(testDir, "plugins/gitlab/agents"), { recursive: true });
    mkdirSync(join(testDir, "plugins/gitlab/commands"), { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("warns on missing skill prefix", async () => {
    const skillPath = join(testDir, "plugins/gitlab/skills/ci/SKILL.md");
    await Bun.write(skillPath, "name: ci\n");

    const warnings = await processHookInput(mockWriteInput(skillPath));
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain("Warning");
    expect(warnings[0]).toContain("should be prefixed");
  });

  it("warns on stuttering skill name after prefix", async () => {
    const skillPath = join(testDir, "plugins/gitlab/skills/ci/SKILL.md");
    await Bun.write(skillPath, "name: gitlab:gitlab-ci\n");

    const warnings = await processHookInput(mockWriteInput(skillPath));
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain("stutters");
  });

  it("warns on stuttering agent name", async () => {
    const agentPath = join(testDir, "plugins/gitlab/agents/gitlab-reviewer.md");
    await Bun.write(agentPath, "---\n");

    const warnings = await processHookInput(mockWriteInput(agentPath));
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain("agent name");
  });

  it("warns on stuttering command name", async () => {
    const cmdPath = join(testDir, "plugins/gitlab/commands/gitlab-merge.md");
    await Bun.write(cmdPath, "---\n");

    const warnings = await processHookInput(mockWriteInput(cmdPath));
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain("command name");
  });

  it("returns empty for properly namespaced skill", async () => {
    const skillPath = join(testDir, "plugins/gitlab/skills/ci/SKILL.md");
    await Bun.write(skillPath, "name: gitlab:ci\n");

    const warnings = await processHookInput(mockWriteInput(skillPath));
    expect(warnings).toEqual([]);
  });

  it("returns empty for primary skill (name matches plugin)", async () => {
    const skillPath = join(testDir, "plugins/gitlab/skills/ci/SKILL.md");
    await Bun.write(skillPath, "name: gitlab\n");

    const warnings = await processHookInput(mockWriteInput(skillPath));
    expect(warnings).toEqual([]);
  });

  it("returns empty for non-plugin paths", async () => {
    const warnings = await processHookInput(mockWriteInput("/Users/ben/src/project/SKILL.md"));
    expect(warnings).toEqual([]);
  });

  it("returns empty for non-file tools", async () => {
    const input = makePostToolUseInput({
      tool_name: "Bash",
      tool_input: { command: "ls" },
      tool_response: { output: "", exit_code: 0 },
    });
    const warnings = await processHookInput(input);
    expect(warnings).toEqual([]);
  });
});
