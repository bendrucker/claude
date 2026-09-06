import { join } from "node:path";
import { estimateTokens, parseSkill } from "./parse";
import { allRules, findReferences, lintReference } from "./rules";
import type { RuleResult, SkillLintResult } from "./types";

export async function lintSkill(skillDir: string): Promise<SkillLintResult> {
  const skillPath = join(skillDir, "SKILL.md");
  const raw = await Bun.file(skillPath).text();
  const content = parseSkill(raw);

  const results: RuleResult[] = [];

  for (const rule of allRules) {
    const result = rule.check(content, skillDir);
    if (Array.isArray(result)) {
      results.push(...result);
    } else {
      results.push(result);
    }
  }

  const refs = findReferences(content.body);
  const referenceResults = await Promise.all(refs.map((ref) => lintReference(skillDir, ref)));

  const refTokens = await Promise.all(
    referenceResults.map(async (ref) => {
      const refFile = Bun.file(join(skillDir, ref.path));
      if (!(await refFile.exists())) return 0;
      return estimateTokens(await refFile.text());
    }),
  );
  const totalTokens = refTokens.reduce((sum, tokens) => sum + tokens, estimateTokens(raw));

  for (const ref of referenceResults) {
    results.push(...ref.results);
  }

  const errors = results.filter((r) => r.severity === "error" && !r.passed).length;
  const warnings = results.filter((r) => r.severity === "warn" && !r.passed).length;

  return {
    path: skillPath,
    errors,
    warnings,
    results: results.filter((r) => r.severity !== "info" || r.rule === "tokens"),
    references: referenceResults,
    tokens: {
      skill: estimateTokens(raw),
      total: totalTokens,
    },
  };
}

export { parseSkill } from "./parse";
export type { RuleResult, SkillLintResult } from "./types";
