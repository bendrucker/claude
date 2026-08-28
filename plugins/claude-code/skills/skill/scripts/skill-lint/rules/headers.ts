import type { Rule, RuleResult, SkillContent } from "../types";

const FENCE_OPEN = /^\s*(`{3,}|~{3,})/;
const FENCE_CLOSE = /^\s*(`{3,}|~{3,})\s*$/;
const LINE_START_LABEL = /^\*\*[^*]+\*\*:/;

interface Fence {
  marker: string;
  length: number;
}

function frontmatterOffset(content: SkillContent): number {
  const prefixLength = content.raw.length - content.body.length;
  if (prefixLength <= 0) return 0;
  return content.raw.slice(0, prefixLength).split("\n").length - 1;
}

function closes(line: string, fence: Fence): boolean {
  const match = line.match(FENCE_CLOSE);
  if (match?.[1] == null || match[1] === "") return false;
  const marker = match[1];
  return marker[0] === fence.marker && marker.length >= fence.length;
}

export const preferHeaders: Rule = {
  name: "prefer-headers",
  severity: "warn",
  check(content: SkillContent): RuleResult[] {
    const results: RuleResult[] = [];
    const offset = frontmatterOffset(content);
    let fence: Fence | null = null;

    content.body.split("\n").forEach((line, index) => {
      if (fence) {
        if (closes(line, fence)) fence = null;
        return;
      }

      const open = line.match(FENCE_OPEN);
      if (open?.[1] != null && open[1] !== "") {
        fence = { marker: open[1][0] ?? "", length: open[1].length };
        return;
      }

      if (!LINE_START_LABEL.test(line)) return;

      results.push({
        rule: "prefer-headers",
        severity: "warn",
        passed: false,
        message: `line-start bold label. Use a #### header for the subsection instead`,
        line: offset + index + 1,
      });
    });

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
