import type {
  ReferenceResult,
  RuleResult,
  SkillLintResult,
} from "../../plugins/claude-code/skills/skill/scripts/skill-lint/types";

function statusIcon(result: RuleResult): string {
  if (result.severity === "info") return "info";
  return result.passed ? "pass" : result.severity;
}

function formatResult(result: RuleResult): string {
  const location = result.line === undefined ? "" : ` (line ${result.line})`;
  return `  [${statusIcon(result)}] ${result.rule}${location}: ${result.message}`;
}

function formatReference(ref: ReferenceResult): string {
  const lines = [`    ${ref.path}:`];
  for (const result of ref.results) {
    lines.push(`      [${statusIcon(result)}] ${result.message}`);
  }
  return lines.join("\n");
}

export function formatText(results: SkillLintResult[]): string {
  const output: string[] = [];

  for (const skill of results) {
    output.push(skill.path);
    output.push("");
    output.push(`Errors: ${skill.errors} | Warnings: ${skill.warnings}`);
    output.push("");

    for (const result of skill.results) {
      output.push(formatResult(result));
    }

    if (skill.references.length > 0) {
      output.push("");
      output.push("  references/");
      for (const ref of skill.references) {
        output.push(formatReference(ref));
      }
    }

    const tokenResult = skill.results.find((r) => r.rule === "tokens");
    if (tokenResult && skill.tokens.total !== skill.tokens.skill) {
      output.push("");
      output.push(
        `  [info] tokens: ~${skill.tokens.skill.toLocaleString()} (SKILL.md) / ~${skill.tokens.total.toLocaleString()} (total)`,
      );
    }

    output.push("");
  }

  return output.join("\n");
}

export function formatJson(results: SkillLintResult[]): string {
  return JSON.stringify(results, null, 2);
}
