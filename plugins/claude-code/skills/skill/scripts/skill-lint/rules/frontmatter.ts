import type { Rule, RuleResult, SkillContent } from "../types";

const SPEC_URL = "https://agentskills.io/specification";

const NAME_PATTERN = /^([a-z0-9-]+:)?[a-z0-9-]+$/;
const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;

export const nameFormat: Rule = {
  name: "name-format",
  severity: "error",
  check(content: SkillContent): RuleResult {
    const name = content.frontmatter.name;

    if (typeof name !== "string") {
      return {
        rule: "name-format",
        severity: "error",
        passed: false,
        message: `name is missing or not a string\n  > "May only contain unicode lowercase alphanumeric characters and hyphens"\n  ${SPEC_URL}#name-field`,
      };
    }

    if (!NAME_PATTERN.test(name)) {
      return {
        rule: "name-format",
        severity: "error",
        passed: false,
        message: `"${name}" contains invalid characters\n  > "May only contain unicode lowercase alphanumeric characters and hyphens"\n  ${SPEC_URL}#name-field`,
      };
    }

    return {
      rule: "name-format",
      severity: "error",
      passed: true,
      message: `"${name}" (${name.length} chars)`,
    };
  },
};

export const nameLength: Rule = {
  name: "name-length",
  severity: "error",
  check(content: SkillContent): RuleResult {
    const name = content.frontmatter.name;

    if (typeof name !== "string") {
      return {
        rule: "name-length",
        severity: "error",
        passed: false,
        message: `name is missing\n  > "Must be 1-64 characters"\n  ${SPEC_URL}#name-field`,
      };
    }

    if (name.length > MAX_NAME_LENGTH) {
      return {
        rule: "name-length",
        severity: "error",
        passed: false,
        message: `"${name}" is ${name.length} chars (max ${MAX_NAME_LENGTH})\n  > "Must be 1-64 characters"\n  ${SPEC_URL}#name-field`,
      };
    }

    return {
      rule: "name-length",
      severity: "error",
      passed: true,
      message: `${name.length} chars (max ${MAX_NAME_LENGTH})`,
    };
  },
};

export const nameEdgeHyphens: Rule = {
  name: "name-edge-hyphens",
  severity: "error",
  check(content: SkillContent): RuleResult {
    const name = content.frontmatter.name;

    if (typeof name !== "string") {
      return {
        rule: "name-edge-hyphens",
        severity: "error",
        passed: true,
        message: "name is missing (checked by other rules)",
      };
    }

    const segments = name.split(":");
    if (segments.some((s) => s.startsWith("-") || s.endsWith("-"))) {
      return {
        rule: "name-edge-hyphens",
        severity: "error",
        passed: false,
        message: `"${name}" starts or ends with hyphen\n  > "Must not start or end with -"\n  ${SPEC_URL}#name-field`,
      };
    }

    return {
      rule: "name-edge-hyphens",
      severity: "error",
      passed: true,
      message: "no leading/trailing hyphens",
    };
  },
};

export const nameConsecutiveHyphens: Rule = {
  name: "name-consecutive-hyphens",
  severity: "error",
  check(content: SkillContent): RuleResult {
    const name = content.frontmatter.name;

    if (typeof name !== "string") {
      return {
        rule: "name-consecutive-hyphens",
        severity: "error",
        passed: true,
        message: "name is missing (checked by other rules)",
      };
    }

    const segments = name.split(":");
    if (segments.some((s) => s.includes("--"))) {
      return {
        rule: "name-consecutive-hyphens",
        severity: "error",
        passed: false,
        message: `"${name}" contains consecutive hyphens\n  > "Must not contain consecutive hyphens (--)"\n  ${SPEC_URL}#name-field`,
      };
    }

    return {
      rule: "name-consecutive-hyphens",
      severity: "error",
      passed: true,
      message: "no consecutive hyphens",
    };
  },
};

export const descriptionRequired: Rule = {
  name: "description-required",
  severity: "error",
  check(content: SkillContent): RuleResult {
    const description = content.frontmatter.description;

    if (typeof description !== "string" || description.trim().length === 0) {
      return {
        rule: "description-required",
        severity: "error",
        passed: false,
        message: `description is required\n  > "Must be 1-1024 characters"\n  ${SPEC_URL}#description-field`,
      };
    }

    return {
      rule: "description-required",
      severity: "error",
      passed: true,
      message: `${description.length} chars`,
    };
  },
};

export const descriptionLength: Rule = {
  name: "description-length",
  severity: "error",
  check(content: SkillContent): RuleResult {
    const description = content.frontmatter.description;

    if (typeof description !== "string") {
      return {
        rule: "description-length",
        severity: "error",
        passed: true,
        message: "description is missing (checked by other rules)",
      };
    }

    if (description.length > MAX_DESCRIPTION_LENGTH) {
      return {
        rule: "description-length",
        severity: "error",
        passed: false,
        message: `${description.length} chars (max ${MAX_DESCRIPTION_LENGTH})\n  > "Must be 1-1024 characters"\n  ${SPEC_URL}#description-field`,
      };
    }

    return {
      rule: "description-length",
      severity: "error",
      passed: true,
      message: `${description.length} chars (max ${MAX_DESCRIPTION_LENGTH})`,
    };
  },
};

export const allowedToolsFormat: Rule = {
  name: "allowed-tools-format",
  severity: "warn",
  check(content: SkillContent): RuleResult {
    const allowedTools = content.frontmatter["allowed-tools"];

    if (allowedTools === undefined) {
      return {
        rule: "allowed-tools-format",
        severity: "warn",
        passed: true,
        message: "allowed-tools not set",
      };
    }

    if (typeof allowedTools === "string") {
      return {
        rule: "allowed-tools-format",
        severity: "warn",
        passed: false,
        message: "allowed-tools should be a YAML array, not a comma-separated string",
      };
    }

    return {
      rule: "allowed-tools-format",
      severity: "warn",
      passed: true,
      message: `${Array.isArray(allowedTools) ? allowedTools.length : 0} tools`,
    };
  },
};

export const effortRequiresFork: Rule = {
  name: "effort-requires-fork",
  severity: "warn",
  check(content: SkillContent): RuleResult {
    const effort = content.frontmatter.effort;

    if (effort === undefined) {
      return {
        rule: "effort-requires-fork",
        severity: "warn",
        passed: true,
        message: "effort not set",
      };
    }

    if (content.frontmatter.context !== "fork") {
      return {
        rule: "effort-requires-fork",
        severity: "warn",
        passed: false,
        message:
          "`effort` on an inline skill rewrites the conversation's cached prefix on every invocation. Pin it only under `context: fork`.",
      };
    }

    return {
      rule: "effort-requires-fork",
      severity: "warn",
      passed: true,
      message: "effort pinned under context: fork",
    };
  },
};

export const frontmatterRules: Rule[] = [
  nameFormat,
  nameLength,
  nameEdgeHyphens,
  nameConsecutiveHyphens,
  descriptionRequired,
  descriptionLength,
  allowedToolsFormat,
  effortRequiresFork,
];
