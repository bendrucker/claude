import * as path from "node:path";
import { countLines } from "../parse";
import type { ReferenceResult, RuleResult } from "../types";
import { markdownLines } from "./fences";

const SPEC_URL = "https://agentskills.io/specification";

const REFERENCE_LINK_PATTERN = /\[.*?\]\((?!https?:\/\/)(references\/[^)]+)\)/g;

// Substituted only in the SKILL.md body and allowed-tools, and exported only to
// hook and MCP subprocesses, so each expands to nothing in a copied command.
const SUBSTITUTION_PATTERN = /\$\{?(CLAUDE_SKILL_DIR|CLAUDE_PLUGIN_ROOT|CLAUDE_PLUGIN_DATA)\}?/g;

const PLACEHOLDERS: Record<string, string> = {
  CLAUDE_SKILL_DIR: "<skill-dir>",
  CLAUDE_PLUGIN_ROOT: "<plugin-root>",
  CLAUDE_PLUGIN_DATA: "<plugin-data>",
};

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

  for (const line of markdownLines(content)) {
    if (!line.fenced) continue;

    for (const match of line.text.matchAll(SUBSTITUTION_PATTERN)) {
      const variable = match[1] ?? "";
      results.push({
        rule: "reference-substitution",
        severity: "warn",
        passed: false,
        message: `\${${variable}} in a fenced block in ${refPath}. Substitution reaches SKILL.md and allowed-tools only, so this expands to nothing when the command runs. State the path in SKILL.md and write ${PLACEHOLDERS[variable] ?? "a placeholder"} here.`,
        line: line.index + 1,
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
      });
    } else {
      results.push({
        rule: "reference-depth",
        severity: "warn",
        passed: true,
        message: `depth ${depth}`,
      });
    }

    results.push(...substitutionResults(content, refPath));
  } else {
    results.push({
      rule: "reference-exists",
      severity: "error",
      passed: false,
      message: `file not found: ${refPath}`,
    });
  }

  return {
    path: refPath,
    lines,
    depth,
    results,
  };
}
