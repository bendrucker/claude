import { describe, expect, it } from "bun:test";
import * as path from "node:path";
import { lintSkill } from "../index";
import { parseSkill } from "../parse";
import {
  descriptionLength,
  descriptionRequired,
  nameConsecutiveHyphens,
  nameEdgeHyphens,
  nameFormat,
  nameLength,
} from "../rules/frontmatter";
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
});

describe("lintSkill", () => {
  it("passes valid skill", () => {
    const result = lintSkill(path.join(fixturesDir, "valid"));
    expect(result.errors).toBe(0);
    expect(result.warnings).toBe(0);
  });

  it("reports invalid name format", () => {
    const result = lintSkill(path.join(fixturesDir, "invalid-name"));
    expect(result.errors).toBeGreaterThan(0);
    const nameError = result.results.find((r) => r.rule === "name-format");
    expect(nameError?.passed).toBe(false);
  });

  it("reports missing description", () => {
    const result = lintSkill(path.join(fixturesDir, "missing-description"));
    expect(result.errors).toBeGreaterThan(0);
    const descError = result.results.find((r) => r.rule === "description-required");
    expect(descError?.passed).toBe(false);
  });

  it("detects references", () => {
    const result = lintSkill(path.join(fixturesDir, "with-references"));
    expect(result.references).toHaveLength(1);
    expect(result.references[0]?.path).toBe("references/language.md");
  });

  it("calculates token counts", () => {
    const result = lintSkill(path.join(fixturesDir, "valid"));
    expect(result.tokens.skill).toBeGreaterThan(0);
    expect(result.tokens.total).toBeGreaterThanOrEqual(result.tokens.skill);
  });
});
