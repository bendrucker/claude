import * as path from "node:path";
import { countLines } from "../parse";
import type { ReferenceResult, RuleResult } from "../types";

const SPEC_URL = "https://agentskills.io/specification";

const REFERENCE_LINK_PATTERN = /\[.*?\]\((?!https?:\/\/)(references\/[^)]+)\)/g;

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
