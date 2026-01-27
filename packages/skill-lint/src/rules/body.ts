import { countLines } from "../parse";
import type { Rule, RuleResult, SkillContent } from "../types";

const SPEC_URL = "https://agentskills.io/specification";

const MAX_BODY_LINES = 500;

export const bodyLines: Rule = {
  name: "body-lines",
  severity: "warn",
  check(content: SkillContent): RuleResult {
    const lines = countLines(content.body);

    if (lines > MAX_BODY_LINES) {
      return {
        rule: "body-lines",
        severity: "warn",
        passed: false,
        message: `${lines} lines (max ${MAX_BODY_LINES})\n  > "Keep your main SKILL.md under 500 lines. Move detailed reference material to separate files."\n  ${SPEC_URL}#progressive-disclosure`,
      };
    }

    return {
      rule: "body-lines",
      severity: "warn",
      passed: true,
      message: `${lines} lines (max ${MAX_BODY_LINES})`,
    };
  },
};

export const bodyRules: Rule[] = [bodyLines];
