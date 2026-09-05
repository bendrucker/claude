import { describe, expect, it, test } from "bun:test";
import * as path from "node:path";
import { lintSkill } from "../index";
import { parseSkill } from "../parse";
import { bangExecutionMatcher } from "../rules/bang-execution";
import {
  allowedToolsFormat,
  descriptionLength,
  descriptionRequired,
  effortRequiresFork,
  nameConsecutiveHyphens,
  nameEdgeHyphens,
  nameFormat,
  nameLength,
} from "../rules/frontmatter";
import { preferHeaders } from "../rules/headers";
import { namespaceMismatch, namespaceStutter } from "../rules/namespace";
import { findReferences, substitutionResults } from "../rules/references";
import type { RuleResult, Severity } from "../types";

const fixturesDir = path.join(import.meta.dirname, "fixtures");

function single(result: RuleResult | RuleResult[]): RuleResult {
  if (Array.isArray(result)) {
    throw new Error("Expected single result");
  }
  return result;
}

describe("parseSkill", () => {
  it("parses frontmatter and body", () => {
    const content = parseSkill(`---
name: test
description: A test skill
---

# Body

Content here.`);

    expect(content.frontmatter.name).toBe("test");
    expect(content.frontmatter.description).toBe("A test skill");
    expect(content.body).toContain("# Body");
  });

  it("handles missing frontmatter", () => {
    const content = parseSkill("# No Frontmatter\n\nJust content.");

    expect(content.frontmatter).toEqual({});
    expect(content.body).toContain("# No Frontmatter");
  });
});

describe("frontmatter rules", () => {
  test.each<{ name: string; frontmatter: string; passed: boolean }>([
    { name: "passes for valid names", frontmatter: "---\nname: valid-name\n---\n", passed: true },
    { name: "fails for uppercase", frontmatter: "---\nname: Invalid\n---\n", passed: false },
    {
      name: "fails for underscores",
      frontmatter: "---\nname: invalid_name\n---\n",
      passed: false,
    },
    { name: "allows numbers", frontmatter: "---\nname: skill123\n---\n", passed: true },
    {
      name: "allows namespaced names",
      frontmatter: "---\nname: github:actions\n---\n",
      passed: true,
    },
    { name: "allows same-name namespace", frontmatter: "---\nname: git:git\n---\n", passed: true },
  ])("nameFormat: $name", ({ frontmatter, passed }) => {
    const content = parseSkill(frontmatter);
    const result = single(nameFormat.check(content, ""));
    expect(result.passed).toBe(passed);
  });

  test.each<{ name: string; frontmatter: string; passed: boolean }>([
    { name: "passes for short names", frontmatter: "---\nname: short\n---\n", passed: true },
    {
      name: "fails for names over 64 chars",
      frontmatter: `---\nname: ${"a".repeat(65)}\n---\n`,
      passed: false,
    },
  ])("nameLength: $name", ({ frontmatter, passed }) => {
    const content = parseSkill(frontmatter);
    const result = single(nameLength.check(content, ""));
    expect(result.passed).toBe(passed);
  });

  test.each<{ name: string; frontmatter: string; passed: boolean }>([
    { name: "passes for valid names", frontmatter: "---\nname: valid-name\n---\n", passed: true },
    { name: "fails for leading hyphen", frontmatter: "---\nname: -invalid\n---\n", passed: false },
    {
      name: "fails for trailing hyphen",
      frontmatter: "---\nname: invalid-\n---\n",
      passed: false,
    },
    {
      name: "fails for leading hyphen in namespace prefix",
      frontmatter: "---\nname: -github:actions\n---\n",
      passed: false,
    },
    {
      name: "fails for trailing hyphen in namespaced part",
      frontmatter: "---\nname: github:actions-\n---\n",
      passed: false,
    },
    {
      name: "passes for valid namespaced names",
      frontmatter: "---\nname: github:actions\n---\n",
      passed: true,
    },
  ])("nameEdgeHyphens: $name", ({ frontmatter, passed }) => {
    const content = parseSkill(frontmatter);
    const result = single(nameEdgeHyphens.check(content, ""));
    expect(result.passed).toBe(passed);
  });

  test.each<{ name: string; frontmatter: string; passed: boolean }>([
    {
      name: "passes for single hyphens",
      frontmatter: "---\nname: valid-name\n---\n",
      passed: true,
    },
    {
      name: "fails for consecutive hyphens",
      frontmatter: "---\nname: invalid--name\n---\n",
      passed: false,
    },
  ])("nameConsecutiveHyphens: $name", ({ frontmatter, passed }) => {
    const content = parseSkill(frontmatter);
    const result = single(nameConsecutiveHyphens.check(content, ""));
    expect(result.passed).toBe(passed);
  });

  test.each<{ name: string; frontmatter: string; passed: boolean }>([
    {
      name: "passes when description exists",
      frontmatter: "---\ndescription: Some description\n---\n",
      passed: true,
    },
    {
      name: "fails when description is missing",
      frontmatter: "---\nname: test\n---\n",
      passed: false,
    },
    {
      name: "fails when description is empty",
      frontmatter: "---\ndescription: ''\n---\n",
      passed: false,
    },
  ])("descriptionRequired: $name", ({ frontmatter, passed }) => {
    const content = parseSkill(frontmatter);
    const result = single(descriptionRequired.check(content, ""));
    expect(result.passed).toBe(passed);
  });

  test.each<{ name: string; frontmatter: string; passed: boolean }>([
    {
      name: "passes for short descriptions",
      frontmatter: "---\ndescription: Short\n---\n",
      passed: true,
    },
    {
      name: "fails for descriptions over 1024 chars",
      frontmatter: `---\ndescription: ${"a".repeat(1025)}\n---\n`,
      passed: false,
    },
  ])("descriptionLength: $name", ({ frontmatter, passed }) => {
    const content = parseSkill(frontmatter);
    const result = single(descriptionLength.check(content, ""));
    expect(result.passed).toBe(passed);
  });

  test.each<{ name: string; frontmatter: string; passed: boolean }>([
    {
      name: "passes when allowed-tools is not set",
      frontmatter: "---\nname: test\n---\n",
      passed: true,
    },
    {
      name: "passes when allowed-tools is an array",
      frontmatter: "---\nallowed-tools:\n  - Bash\n  - Read\n---\n",
      passed: true,
    },
    {
      name: "passes when allowed-tools is an inline array",
      frontmatter: "---\nallowed-tools: [Bash, Read]\n---\n",
      passed: true,
    },
    {
      name: "fails when allowed-tools is a comma-separated string",
      frontmatter: "---\nallowed-tools: Bash(gh:*), mcp__github\n---\n",
      passed: false,
    },
  ])("allowedToolsFormat: $name", ({ frontmatter, passed }) => {
    const content = parseSkill(frontmatter);
    const result = single(allowedToolsFormat.check(content, ""));
    expect(result.passed).toBe(passed);
  });

  test.each<{ name: string; frontmatter: string; passed: boolean }>([
    {
      name: "passes when effort is not set",
      frontmatter: "---\nname: test\n---\n",
      passed: true,
    },
    {
      name: "passes when effort is paired with context: fork",
      frontmatter: "---\neffort: low\ncontext: fork\n---\n",
      passed: true,
    },
    {
      name: "fails when effort is set on an inline skill",
      frontmatter: "---\neffort: low\n---\n",
      passed: false,
    },
    {
      name: "fails when effort is set with a non-fork context",
      frontmatter: "---\neffort: low\ncontext: inline\n---\n",
      passed: false,
    },
  ])("effortRequiresFork: $name", ({ frontmatter, passed }) => {
    const content = parseSkill(frontmatter);
    const result = single(effortRequiresFork.check(content, ""));
    expect(result.passed).toBe(passed);
  });
});

describe("findReferences", () => {
  it("strips anchor fragments so link variants resolve to one file", () => {
    const body = "[a](references/patterns.md) and [b](references/patterns.md#reasoning-effort)";
    expect(findReferences(body)).toEqual(["references/patterns.md"]);
  });
});

describe("bangExecutionMatcher", () => {
  const root = ["$", "{CLAUDE_PLUGIN_ROOT}"].join("");
  const skill = (allowedTools: string, body: string) =>
    parseSkill(`---\nname: test\nallowed-tools:\n${allowedTools}\n---\n\n${body}\n`);

  test.each<{
    name: string;
    allowedTools: string;
    body: string;
    passed: boolean;
    severity?: Severity;
    message?: string;
  }>([
    {
      name: "passes when the open-glob shape matches a bang command",
      allowedTools: `  - "Bash(bun ${root}/scripts/*)"`,
      body: `- Out: !\`bun ${root}/scripts/context.ts\``,
      passed: true,
    },
    {
      name: "warns when a :* glob matcher matches a bang command",
      allowedTools: `  - "Bash(bun ${root}/scripts/*:*)"`,
      body: `- Out: !\`bun ${root}/scripts/context.ts\``,
      passed: false,
      severity: "warn",
      message: `Bash(bun ${root}/scripts/*:*)`,
    },
    {
      name: "passes when there is no bang execution",
      allowedTools: `  - "Bash(bun ${root}/scripts/*:*)"`,
      body: "Run the script when needed.",
      passed: true,
    },
    {
      name: "ignores a :* glob matcher that no bang command uses",
      allowedTools: '  - "Bash(git show :*:*)"\n  - "Bash(jq:*)"',
      body: "- List: !`tuicr review list`",
      passed: true,
    },
    {
      name: "passes when a bang command is matched by a command-prefix matcher",
      allowedTools: '  - "Bash(uname:*)"',
      body: "- OS: !`uname -s`",
      passed: true,
    },
  ])("$name", ({ allowedTools, body, passed, severity, message }) => {
    const content = skill(allowedTools, body);
    const result = single(bangExecutionMatcher.check(content, ""));
    expect(result.passed).toBe(passed);
    if (severity != null) {
      expect(result.severity).toBe(severity);
    }
    if (message != null && message !== "") {
      expect(result.message).toContain(message);
    }
  });
});

describe("preferHeaders", () => {
  const failing = (body: string) => {
    const result = preferHeaders.check(parseSkill(body), "");
    const results = Array.isArray(result) ? result : [result];
    return results.filter((r) => !r.passed);
  };

  test.each<{ name: string; body: string; flagged: boolean }>([
    { name: "flags a line-start bold label", body: "**Config**: value", flagged: true },
    { name: "passes a hyphen list-item label", body: "- **Item**: value", flagged: false },
    { name: "passes a numbered list-item label", body: "1. **Step**: value", flagged: false },
    {
      name: "passes mid-sentence bold",
      body: "A line carrying **inline bold**: continues here",
      flagged: false,
    },
    {
      name: "passes a bold label inside a fenced block",
      body: "```md\n**Fenced**: value\n```",
      flagged: false,
    },
    {
      name: "passes a label inside a block that nests a different fence marker",
      body: "```md\n~~~\n**Inner**: value\n~~~\n```",
      flagged: false,
    },
    {
      name: "passes a bold label inside an indented code block",
      body: "intro\n\n    **Config**: value",
      flagged: false,
    },
    {
      name: "flags a bold label opening the lazily continued second line of a paragraph",
      body: "some text\n**Config**: value",
      flagged: true,
    },
  ])("$name", ({ body, flagged }) => {
    expect(failing(body).length > 0).toBe(flagged);
  });

  it("reports the offending line number and warn severity", () => {
    const [offender] = failing("intro\n\n**Config**: value");
    expect(offender?.severity).toBe("warn");
    expect(offender?.line).toBe(3);
  });
});

describe("substitutionResults", () => {
  // Built by hand so the fixture file itself never carries a literal the rule flags.
  const v = (name: string) => ["$", "{", name, "}"].join("");
  const failing = (content: string, refPath = "references/example.md") =>
    substitutionResults(content, refPath).filter((r) => !r.passed);

  test.each<{ name: string; content: string; flagged: boolean }>([
    {
      name: "flags a skill dir in a bash block",
      content: `\`\`\`bash\nbun ${v("CLAUDE_SKILL_DIR")}/scripts/hosts.ts\n\`\`\``,
      flagged: true,
    },
    {
      name: "flags a plugin root in a bash block",
      content: `\`\`\`bash\nbun ${v("CLAUDE_PLUGIN_ROOT")}/scripts/x.ts\n\`\`\``,
      flagged: true,
    },
    {
      name: "flags a plugin data dir in a bash block",
      content: `\`\`\`bash\nduckdb ${v("CLAUDE_PLUGIN_DATA")}/session.duckdb\n\`\`\``,
      flagged: true,
    },
    {
      name: "flags the unbraced form",
      content: "```bash\nbun $CLAUDE_SKILL_DIR/scripts/x.ts\n```",
      flagged: true,
    },
    {
      name: "flags inside a tilde fence",
      content: `~~~bash\nbun ${v("CLAUDE_SKILL_DIR")}/scripts/x.ts\n~~~`,
      flagged: true,
    },
    {
      name: "flags inside an indented code block",
      content: `intro\n\n    bun ${v("CLAUDE_SKILL_DIR")}/scripts/x.ts`,
      flagged: true,
    },
    {
      name: "flags inside a tilde fence whose content contains backtick fence markers",
      content: `~~~bash\n\`\`\`\nbun ${v("CLAUDE_SKILL_DIR")}/scripts/x.ts\n\`\`\`\n~~~`,
      flagged: true,
    },
    {
      name: "passes prose describing the variable in inline backticks",
      content: `Use \`${v("CLAUDE_PLUGIN_ROOT")}/skills/<name>\` to reference skill-local scripts.`,
      flagged: false,
    },
    {
      name: "passes a bare name with no substitution sigil",
      content: "```bash\necho CLAUDE_PLUGIN_DATA\n```",
      flagged: false,
    },
    {
      name: "passes a placeholder path",
      content: "```bash\nbun <skill-dir>/scripts/hosts.ts\n```",
      flagged: false,
    },
    {
      name: "passes a longer name that merely starts with a watched one",
      content: "```bash\nbun $CLAUDE_SKILL_DIRECTORY/scripts/x.ts\n```",
      flagged: false,
    },
    {
      name: "passes prose after a fenced block closes",
      content: `\`\`\`bash\nbun scripts/x.ts\n\`\`\`\n\nSet \`${v("CLAUDE_SKILL_DIR")}\` in SKILL.md.`,
      flagged: false,
    },
  ])("$name", ({ content, flagged }) => {
    expect(failing(content).length > 0).toBe(flagged);
  });

  it("reports the whole finding", () => {
    expect(failing(`intro\n\n\`\`\`bash\nbun ${v("CLAUDE_SKILL_DIR")}/x.ts\n\`\`\``))
      .toMatchInlineSnapshot(`
      [
        {
          "line": 4,
          "message": "\${CLAUDE_SKILL_DIR} in a code block. Substitution reaches SKILL.md and allowed-tools only, so this expands to nothing when the command runs. State the path in SKILL.md and write a placeholder here, e.g. <skill-dir>.",
          "passed": false,
          "reference": "references/example.md",
          "rule": "reference-substitution",
          "severity": "warn",
        },
      ]
    `);
  });

  it("reports the exact line for an indented code block", () => {
    const [offender] = failing(`intro\n\n    bun ${v("CLAUDE_SKILL_DIR")}/x.ts`);
    expect(offender?.line).toBe(3);
  });

  test.each<{ variable: string; placeholder: string }>([
    { variable: "CLAUDE_SKILL_DIR", placeholder: "<skill-dir>" },
    { variable: "CLAUDE_PLUGIN_ROOT", placeholder: "<plugin-root>" },
    { variable: "CLAUDE_PLUGIN_DATA", placeholder: "<plugin-data>" },
  ])("suggests $placeholder for $variable", ({ variable, placeholder }) => {
    const [offender] = failing(`\`\`\`bash\nbun ${v(variable)}/x.ts\n\`\`\``);
    expect(offender?.message).toContain(placeholder);
  });

  it("flags every occurrence on a line", () => {
    const content = `\`\`\`bash\nduckdb ${v("CLAUDE_PLUGIN_DATA")}/s.duckdb < ${v("CLAUDE_SKILL_DIR")}/q.sql\n\`\`\``;
    expect(failing(content)).toHaveLength(2);
  });

  // These repo files describe the substitution syntax in prose. The rule must
  // not fire on any of them.
  const repoRoot = path.join(import.meta.dirname, "../../../../../../..");

  test.each([
    "plugins/claude-code/skills/skill/references/patterns.md",
    "plugins/writing/skills/analyze/references/methodology.md",
    "plugins/claude-code/skills/hook/references/debugging.md",
  ])("passes prose in %s", async (relative) => {
    const content = await Bun.file(path.join(repoRoot, relative)).text();
    expect(failing(content, relative)).toEqual([]);
  });
});

describe("namespace rules", () => {
  const pluginPath = (plugin: string) => `plugins/${plugin}/skills/some-skill`;

  test.each<{ name: string; skillName: string; plugin: string; passed: boolean }>([
    {
      name: "passes when prefix matches plugin",
      skillName: "github:actions",
      plugin: "github",
      passed: true,
    },
    { name: "passes when no prefix", skillName: "actions", plugin: "github", passed: true },
    {
      name: "fails when prefix mismatches plugin",
      skillName: "gitlab:foo",
      plugin: "github",
      passed: false,
    },
  ])("namespaceMismatch: $name", ({ skillName, plugin, passed }) => {
    const content = parseSkill(`---\nname: ${skillName}\n---\n`);
    const result = single(namespaceMismatch.check(content, pluginPath(plugin)));
    expect(result.passed).toBe(passed);
  });

  it("namespaceMismatch: skips when not in a plugin directory", () => {
    const content = parseSkill("---\nname: gitlab:foo\n---\n");
    const result = single(namespaceMismatch.check(content, "/some/other/path"));
    expect(result.passed).toBe(true);
  });

  test.each<{ name: string; skillName: string; plugin: string; passed: boolean; warn?: boolean }>([
    {
      name: "passes for non-stuttering names",
      skillName: "gitlab:ci",
      plugin: "gitlab",
      passed: true,
    },
    {
      name: "warns on stuttering suffix",
      skillName: "gitlab:gitlab-ci",
      plugin: "gitlab",
      passed: false,
      warn: true,
    },
    {
      name: "passes when suffix equals plugin name",
      skillName: "git:git",
      plugin: "git",
      passed: true,
    },
    {
      name: "permits the entry-skill convention (plugin:plugin)",
      skillName: "writing:writing",
      plugin: "writing",
      passed: true,
    },
    {
      name: "warns on redundant-suffix stutter (plugin:plugin-foo)",
      skillName: "writing:writing-analyze",
      plugin: "writing",
      passed: false,
      warn: true,
    },
    { name: "passes when no prefix", skillName: "actions", plugin: "github", passed: true },
  ])("namespaceStutter: $name", ({ skillName, plugin, passed, warn }) => {
    const content = parseSkill(`---\nname: ${skillName}\n---\n`);
    const result = single(namespaceStutter.check(content, pluginPath(plugin)));
    expect(result.passed).toBe(passed);
    if (warn) {
      expect(result.severity).toBe("warn");
    }
  });
});

describe("lintSkill", () => {
  it("passes valid skill", async () => {
    const result = await lintSkill(path.join(fixturesDir, "valid"));
    expect(result.errors).toBe(0);
    expect(result.warnings).toBe(0);
  });

  it("reports invalid name format", async () => {
    const result = await lintSkill(path.join(fixturesDir, "invalid-name"));
    expect(result.errors).toBeGreaterThan(0);
    const nameError = result.results.find((r) => r.rule === "name-format");
    expect(nameError?.passed).toBe(false);
  });

  it("reports missing description", async () => {
    const result = await lintSkill(path.join(fixturesDir, "missing-description"));
    expect(result.errors).toBeGreaterThan(0);
    const descError = result.results.find((r) => r.rule === "description-required");
    expect(descError?.passed).toBe(false);
  });

  it("warns on line-start bold labels without failing", async () => {
    const result = await lintSkill(path.join(fixturesDir, "prefer-headers"));
    expect(result.errors).toBe(0);
    const offenders = result.results.filter((r) => r.rule === "prefer-headers" && !r.passed);
    expect(offenders).toHaveLength(1);
    expect(offenders[0]?.line).toBe(8);
  });

  it("detects references", async () => {
    const result = await lintSkill(path.join(fixturesDir, "with-references"));
    expect(result.references).toHaveLength(1);
    expect(result.references[0]?.path).toBe("references/language.md");
  });

  it("calculates token counts", async () => {
    const result = await lintSkill(path.join(fixturesDir, "valid"));
    expect(result.tokens.skill).toBeGreaterThan(0);
    expect(result.tokens.total).toBeGreaterThanOrEqual(result.tokens.skill);
  });
});
