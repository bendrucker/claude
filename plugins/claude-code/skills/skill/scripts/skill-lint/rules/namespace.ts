import type { Rule, RuleResult, SkillContent } from "../types";

function pluginName(skillPath: string): string | null {
  const match = skillPath.match(/plugins\/([^/]+)\/skills\//);
  return match?.[1] ?? null;
}

export const namespaceMismatch: Rule = {
  name: "namespace-mismatch",
  severity: "error",
  check(content: SkillContent, path: string): RuleResult {
    const name = content.frontmatter.name;
    const plugin = pluginName(path);

    if (typeof name !== "string" || plugin == null || plugin === "") {
      return {
        rule: "namespace-mismatch",
        severity: "error",
        passed: true,
        message: "skipped (no name or not in a plugin)",
      };
    }

    const colonIndex = name.indexOf(":");
    if (colonIndex === -1) {
      return {
        rule: "namespace-mismatch",
        severity: "error",
        passed: true,
        message: "no namespace prefix",
      };
    }

    const prefix = name.slice(0, colonIndex);
    if (prefix !== plugin) {
      return {
        rule: "namespace-mismatch",
        severity: "error",
        passed: false,
        message: `prefix "${prefix}:" does not match plugin "${plugin}"`,
      };
    }

    return {
      rule: "namespace-mismatch",
      severity: "error",
      passed: true,
      message: `prefix matches plugin "${plugin}"`,
    };
  },
};

export const namespaceStutter: Rule = {
  name: "namespace-stutter",
  severity: "warn",
  check(content: SkillContent, path: string): RuleResult {
    const name = content.frontmatter.name;
    const plugin = pluginName(path);

    if (typeof name !== "string" || plugin == null || plugin === "") {
      return {
        rule: "namespace-stutter",
        severity: "warn",
        passed: true,
        message: "skipped (no name or not in a plugin)",
      };
    }

    const colonIndex = name.indexOf(":");
    if (colonIndex === -1) {
      return {
        rule: "namespace-stutter",
        severity: "warn",
        passed: true,
        message: "no namespace prefix",
      };
    }

    const suffix = name.slice(colonIndex + 1);
    // Exact `plugin:plugin` (suffix === plugin) is the intentional entry-skill
    // convention and is permitted. Only the redundant-suffix form
    // (`plugin:plugin-foo`) stutters, so the check requires a trailing hyphen.
    if (suffix.startsWith(`${plugin}-`)) {
      return {
        rule: "namespace-stutter",
        severity: "warn",
        passed: false,
        message: `"${name}" stutters — "${suffix}" repeats the plugin name as a prefix`,
      };
    }

    return {
      rule: "namespace-stutter",
      severity: "warn",
      passed: true,
      message: "no stuttering",
    };
  },
};

export const namespaceRules: Rule[] = [namespaceMismatch, namespaceStutter];
