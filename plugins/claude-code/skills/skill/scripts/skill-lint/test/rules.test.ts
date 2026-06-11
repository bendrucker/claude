import { describe, expect, it } from "bun:test";
import * as path from "node:path";
import { lintSkill } from "../index";
import { parseSkill } from "../parse";
import { bangExecutionMatcher } from "../rules/bang-execution";
import {
  allowedToolsFormat,
  descriptionLength,
  descriptionRequired,
  nameConsecutiveHyphens,
  nameEdgeHyphens,
  nameFormat,
  nameLength,
} from "../rules/frontmatter";
import { namespaceMismatch, namespaceStutter } from "../rules/namespace";
import type { RuleResult } from "../types";

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
  describe("nameFormat", () => {
    it("passes for valid names", () => {
      const content = parseSkill("---\nname: valid-name\n---\n");
      const result = single(nameFormat.check(content, ""));
      expect(result.passed).toBe(true);
    });

    it("fails for uppercase", () => {
      const content = parseSkill("---\nname: Invalid\n---\n");
      const result = single(nameFormat.check(content, ""));
      expect(result.passed).toBe(false);
    });

    it("fails for underscores", () => {
      const content = parseSkill("---\nname: invalid_name\n---\n");
      const result = single(nameFormat.check(content, ""));
      expect(result.passed).toBe(false);
    });

    it("allows numbers", () => {
      const content = parseSkill("---\nname: skill123\n---\n");
      const result = single(nameFormat.check(content, ""));
      expect(result.passed).toBe(true);
    });

    it("allows namespaced names", () => {
      const content = parseSkill("---\nname: github:actions\n---\n");
      const result = single(nameFormat.check(content, ""));
      expect(result.passed).toBe(true);
    });

    it("allows same-name namespace", () => {
      const content = parseSkill("---\nname: git:git\n---\n");
      const result = single(nameFormat.check(content, ""));
      expect(result.passed).toBe(true);
    });
  });

  describe("nameLength", () => {
    it("passes for short names", () => {
      const content = parseSkill("---\nname: short\n---\n");
      const result = single(nameLength.check(content, ""));
      expect(result.passed).toBe(true);
    });

    it("fails for names over 64 chars", () => {
      const longName = "a".repeat(65);
      const content = parseSkill(`---\nname: ${longName}\n---\n`);
      const result = single(nameLength.check(content, ""));
      expect(result.passed).toBe(false);
    });
  });

  describe("nameEdgeHyphens", () => {
    it("passes for valid names", () => {
      const content = parseSkill("---\nname: valid-name\n---\n");
      const result = single(nameEdgeHyphens.check(content, ""));
      expect(result.passed).toBe(true);
    });

    it("fails for leading hyphen", () => {
      const content = parseSkill("---\nname: -invalid\n---\n");
      const result = single(nameEdgeHyphens.check(content, ""));
      expect(result.passed).toBe(false);
    });

    it("fails for trailing hyphen", () => {
      const content = parseSkill("---\nname: invalid-\n---\n");
      const result = single(nameEdgeHyphens.check(content, ""));
      expect(result.passed).toBe(false);
    });

    it("fails for leading hyphen in namespace prefix", () => {
      const content = parseSkill("---\nname: -github:actions\n---\n");
      const result = single(nameEdgeHyphens.check(content, ""));
      expect(result.passed).toBe(false);
    });

    it("fails for trailing hyphen in namespaced part", () => {
      const content = parseSkill("---\nname: github:actions-\n---\n");
      const result = single(nameEdgeHyphens.check(content, ""));
      expect(result.passed).toBe(false);
    });

    it("passes for valid namespaced names", () => {
      const content = parseSkill("---\nname: github:actions\n---\n");
      const result = single(nameEdgeHyphens.check(content, ""));
      expect(result.passed).toBe(true);
    });
  });

  describe("nameConsecutiveHyphens", () => {
    it("passes for single hyphens", () => {
      const content = parseSkill("---\nname: valid-name\n---\n");
      const result = single(nameConsecutiveHyphens.check(content, ""));
      expect(result.passed).toBe(true);
    });

    it("fails for consecutive hyphens", () => {
      const content = parseSkill("---\nname: invalid--name\n---\n");
      const result = single(nameConsecutiveHyphens.check(content, ""));
      expect(result.passed).toBe(false);
    });
  });

  describe("descriptionRequired", () => {
    it("passes when description exists", () => {
      const content = parseSkill("---\ndescription: Some description\n---\n");
      const result = single(descriptionRequired.check(content, ""));
      expect(result.passed).toBe(true);
    });

    it("fails when description is missing", () => {
      const content = parseSkill("---\nname: test\n---\n");
      const result = single(descriptionRequired.check(content, ""));
      expect(result.passed).toBe(false);
    });

    it("fails when description is empty", () => {
      const content = parseSkill("---\ndescription: ''\n---\n");
      const result = single(descriptionRequired.check(content, ""));
      expect(result.passed).toBe(false);
    });
  });

  describe("descriptionLength", () => {
    it("passes for short descriptions", () => {
      const content = parseSkill("---\ndescription: Short\n---\n");
      const result = single(descriptionLength.check(content, ""));
      expect(result.passed).toBe(true);
    });

    it("fails for descriptions over 1024 chars", () => {
      const longDesc = "a".repeat(1025);
      const content = parseSkill(`---\ndescription: ${longDesc}\n---\n`);
      const result = single(descriptionLength.check(content, ""));
      expect(result.passed).toBe(false);
    });
  });

  describe("allowedToolsFormat", () => {
    it("passes when allowed-tools is not set", () => {
      const content = parseSkill("---\nname: test\n---\n");
      const result = single(allowedToolsFormat.check(content, ""));
      expect(result.passed).toBe(true);
    });

    it("passes when allowed-tools is an array", () => {
      const content = parseSkill("---\nallowed-tools:\n  - Bash\n  - Read\n---\n");
      const result = single(allowedToolsFormat.check(content, ""));
      expect(result.passed).toBe(true);
    });

    it("passes when allowed-tools is an inline array", () => {
      const content = parseSkill("---\nallowed-tools: [Bash, Read]\n---\n");
      const result = single(allowedToolsFormat.check(content, ""));
      expect(result.passed).toBe(true);
    });

    it("fails when allowed-tools is a comma-separated string", () => {
      const content = parseSkill("---\nallowed-tools: Bash(gh:*), mcp__github\n---\n");
      const result = single(allowedToolsFormat.check(content, ""));
      expect(result.passed).toBe(false);
    });
  });
});

describe("bangExecutionMatcher", () => {
  const root = ["$", "{CLAUDE_PLUGIN_ROOT}"].join("");
  const skill = (allowedTools: string, body: string) =>
    parseSkill(`---\nname: test\nallowed-tools:\n${allowedTools}\n---\n\n${body}\n`);

  it("passes when the open-glob shape matches a bang command", () => {
    const content = skill(
      `  - "Bash(bun ${root}/scripts/*)"`,
      `- Out: !\`bun ${root}/scripts/context.ts\``,
    );
    const result = single(bangExecutionMatcher.check(content, ""));
    expect(result.passed).toBe(true);
  });

  it("warns when a :* glob matcher matches a bang command", () => {
    const content = skill(
      `  - "Bash(bun ${root}/scripts/*:*)"`,
      `- Out: !\`bun ${root}/scripts/context.ts\``,
    );
    const result = single(bangExecutionMatcher.check(content, ""));
    expect(result.passed).toBe(false);
    expect(result.severity).toBe("warn");
    expect(result.message).toContain(`Bash(bun ${root}/scripts/*:*)`);
  });

  it("passes when there is no bang execution", () => {
    const content = skill(`  - "Bash(bun ${root}/scripts/*:*)"`, "Run the script when needed.");
    const result = single(bangExecutionMatcher.check(content, ""));
    expect(result.passed).toBe(true);
  });

  it("ignores a :* glob matcher that no bang command uses", () => {
    const content = skill(
      '  - "Bash(git show :*:*)"\n  - "Bash(jq:*)"',
      "- List: !`tuicr review list`",
    );
    const result = single(bangExecutionMatcher.check(content, ""));
    expect(result.passed).toBe(true);
  });

  it("passes when a bang command is matched by a command-prefix matcher", () => {
    const content = skill('  - "Bash(uname:*)"', "- OS: !`uname -s`");
    const result = single(bangExecutionMatcher.check(content, ""));
    expect(result.passed).toBe(true);
  });
});

describe("namespace rules", () => {
  const pluginPath = (plugin: string) => `plugins/${plugin}/skills/some-skill`;

  describe("namespaceMismatch", () => {
    it("passes when prefix matches plugin", () => {
      const content = parseSkill("---\nname: github:actions\n---\n");
      const result = single(namespaceMismatch.check(content, pluginPath("github")));
      expect(result.passed).toBe(true);
    });

    it("passes when no prefix", () => {
      const content = parseSkill("---\nname: actions\n---\n");
      const result = single(namespaceMismatch.check(content, pluginPath("github")));
      expect(result.passed).toBe(true);
    });

    it("fails when prefix mismatches plugin", () => {
      const content = parseSkill("---\nname: gitlab:foo\n---\n");
      const result = single(namespaceMismatch.check(content, pluginPath("github")));
      expect(result.passed).toBe(false);
    });

    it("skips when not in a plugin directory", () => {
      const content = parseSkill("---\nname: gitlab:foo\n---\n");
      const result = single(namespaceMismatch.check(content, "/some/other/path"));
      expect(result.passed).toBe(true);
    });
  });

  describe("namespaceStutter", () => {
    it("passes for non-stuttering names", () => {
      const content = parseSkill("---\nname: gitlab:ci\n---\n");
      const result = single(namespaceStutter.check(content, pluginPath("gitlab")));
      expect(result.passed).toBe(true);
    });

    it("warns on stuttering suffix", () => {
      const content = parseSkill("---\nname: gitlab:gitlab-ci\n---\n");
      const result = single(namespaceStutter.check(content, pluginPath("gitlab")));
      expect(result.passed).toBe(false);
      expect(result.severity).toBe("warn");
    });

    it("passes when suffix equals plugin name", () => {
      const content = parseSkill("---\nname: git:git\n---\n");
      const result = single(namespaceStutter.check(content, pluginPath("git")));
      expect(result.passed).toBe(true);
    });

    it("permits the entry-skill convention (plugin:plugin)", () => {
      const content = parseSkill("---\nname: writing:writing\n---\n");
      const result = single(namespaceStutter.check(content, pluginPath("writing")));
      expect(result.passed).toBe(true);
    });

    it("warns on redundant-suffix stutter (plugin:plugin-foo)", () => {
      const content = parseSkill("---\nname: writing:writing-analyze\n---\n");
      const result = single(namespaceStutter.check(content, pluginPath("writing")));
      expect(result.passed).toBe(false);
      expect(result.severity).toBe("warn");
    });

    it("passes when no prefix", () => {
      const content = parseSkill("---\nname: actions\n---\n");
      const result = single(namespaceStutter.check(content, pluginPath("github")));
      expect(result.passed).toBe(true);
    });
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
