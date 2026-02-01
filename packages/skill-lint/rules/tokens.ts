import { estimateTokens } from "../parse";
import type { Rule, RuleResult, SkillContent } from "../types";

export const tokensInfo: Rule = {
  name: "tokens",
  severity: "info",
  check(content: SkillContent): RuleResult {
    const tokens = estimateTokens(content.raw);

    return {
      rule: "tokens",
      severity: "info",
      passed: true,
      message: `~${tokens.toLocaleString()} (SKILL.md)`,
    };
  },
};

export const tokenRules: Rule[] = [tokensInfo];
