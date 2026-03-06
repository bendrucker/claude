import * as fs from "node:fs";
import * as path from "node:path";
import { estimateTokens, parseSkill } from "./parse";
import { allRules, findReferences, lintReference } from "./rules";
import type { RuleResult, SkillLintResult } from "./types";

export function lintSkill(skillDir: string): SkillLintResult {
  const skillPath = path.join(skillDir, "SKILL.md");
  const raw = fs.readFileSync(skillPath, "utf-8");
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
  const referenceResults = refs.map((ref) => lintReference(skillDir, ref));

  let totalTokens = estimateTokens(raw);
  for (const ref of referenceResults) {
    const refPath = path.join(skillDir, ref.path);
    try {
      const refContent = fs.readFileSync(refPath, "utf-8");
      totalTokens += estimateTokens(refContent);
    } catch {
      // Reference doesn't exist, already reported
    }
  }

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
