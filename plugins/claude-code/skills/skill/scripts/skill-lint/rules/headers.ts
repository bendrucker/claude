import type { Rule, RuleResult, SkillContent } from "../types";
import { boldLabelLines } from "./markdown";

function frontmatterOffset(content: SkillContent): number {
  const prefixLength = content.raw.length - content.body.length;
  if (prefixLength <= 0) return 0;
  return content.raw.slice(0, prefixLength).split("\n").length - 1;
}

export const preferHeaders: Rule = {
  name: "prefer-headers",
  severity: "warn",
  check(content: SkillContent): RuleResult[] {
    const offset = frontmatterOffset(content);

    const results: RuleResult[] = boldLabelLines(content.body).map((line) => ({
      rule: "prefer-headers",
      severity: "warn" as const,
      passed: false,
      message: `line-start bold label. Use a #### header for the subsection instead`,
      line: offset + line,
    }));

    if (results.length === 0) {
      return [
        {
          rule: "prefer-headers",
          severity: "warn",
          passed: true,
          message: "no line-start bold labels",
        },
      ];
    }

    return results;
  },
};

export const headerRules: Rule[] = [preferHeaders];
