import * as path from "node:path";
import { countLines } from "../parse";
import type { ReferenceResult, RuleResult } from "../types";
import { codeSpans, lineAt } from "./markdown";

const SPEC_URL = "https://agentskills.io/specification";

const REFERENCE_LINK_PATTERN = /\[.*?\]\((?!https?:\/\/)(references\/[^)]+)\)/g;

const PLACEHOLDERS = new Map([
  ["CLAUDE_SKILL_DIR", "<skill-dir>"],
  ["CLAUDE_PLUGIN_ROOT", "<plugin-root>"],
  ["CLAUDE_PLUGIN_DATA", "<plugin-data>"],
]);

// \b after the name keeps $CLAUDE_SKILL_DIRECTORY from matching CLAUDE_SKILL_DIR.
const SUBSTITUTION_PATTERN = new RegExp(
  `\\$\\{?(${Array.from(PLACEHOLDERS.keys()).join("|")})\\b\\}?`,
  "g",
);

export function findReferences(body: string): string[] {
  const matches = body.matchAll(REFERENCE_LINK_PATTERN);
  const refs = new Set<string>();

  for (const match of matches) {
    const ref = match[1]?.split("#")[0];
    if (ref != null && ref !== "") refs.add(ref);
  }

  return Array.from(refs);
}

export function getDepth(refPath: string): number {
  const parts = refPath.split("/").filter(Boolean);
  return parts.length - 1;
}

export function substitutionResults(content: string, refPath: string): RuleResult[] {
  const results: RuleResult[] = [];

  for (const { start, end } of codeSpans(content)) {
    const block = content.slice(start, end);

    for (const match of block.matchAll(SUBSTITUTION_PATTERN)) {
      const placeholder = PLACEHOLDERS.get(match[1] ?? "");
      if (placeholder == null) continue;

      results.push({
        rule: "reference-substitution",
        severity: "warn",
        passed: false,
        message: `\${${match[1]}} in a code block. Substitution reaches SKILL.md and allowed-tools only, so this expands to nothing when the command runs. State the path in SKILL.md and write a placeholder here, e.g. ${placeholder}.`,
        line: lineAt(content, start + match.index),
        reference: refPath,
      });
    }
  }

  if (results.length === 0) {
    return [
      {
        rule: "reference-substitution",
        severity: "warn",
        passed: true,
        message: "no substitution variables in code blocks",
        reference: refPath,
      },
    ];
  }

  return results;
}

export async function lintReference(skillDir: string, refPath: string): Promise<ReferenceResult> {
  const fullPath = path.join(skillDir, refPath);
  const results: RuleResult[] = [];
  let lines = 0;
  const depth = getDepth(refPath);

  const file = Bun.file(fullPath);
  if (await file.exists()) {
    const content = await file.text();
    lines = countLines(content);

    if (depth > 1) {
      results.push({
        rule: "reference-depth",
        severity: "warn",
        passed: false,
        message: `depth ${depth} (max 1)\n  > "Keep file references one level deep from SKILL.md. Avoid deeply nested reference chains."\n  ${SPEC_URL}#file-references`,
        reference: refPath,
      });
    } else {
      results.push({
        rule: "reference-depth",
        severity: "warn",
        passed: true,
        message: `depth ${depth}`,
        reference: refPath,
      });
    }

    results.push(...substitutionResults(content, refPath));
  } else {
    results.push({
      rule: "reference-exists",
      severity: "error",
      passed: false,
      message: `file not found: ${refPath}`,
      reference: refPath,
    });
  }

  return {
    path: refPath,
    lines,
    depth,
    results,
  };
}
