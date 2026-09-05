import { z } from "zod";

export type Severity = "error" | "warn" | "info";

export interface RuleResult {
  rule: string;
  severity: Severity;
  passed: boolean;
  message: string;
  line?: number;
  /** Set when the result describes a reference file rather than SKILL.md. */
  reference?: string;
}

export interface ReferenceResult {
  path: string;
  lines: number;
  depth: number;
  results: RuleResult[];
}

export interface SkillLintResult {
  path: string;
  errors: number;
  warnings: number;
  results: RuleResult[];
  references: ReferenceResult[];
  tokens: {
    skill: number;
    total: number;
  };
}

// The rules report a non-string name or description themselves, so both stay
// optional here rather than failing the parse.
export const Frontmatter = z.looseObject({
  name: z.string().optional().catch(undefined),
  description: z.string().optional().catch(undefined),
});

export interface SkillContent {
  frontmatter: z.infer<typeof Frontmatter>;
  body: string;
  raw: string;
}

export interface Rule {
  name: string;
  severity: Severity;
  check: (content: SkillContent, path: string) => RuleResult | RuleResult[];
}
