export type Severity = "error" | "warn" | "info";

export interface RuleResult {
  rule: string;
  severity: Severity;
  passed: boolean;
  message: string;
  line?: number;
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

export interface SkillContent {
  frontmatter: {
    name?: string;
    description?: string;
    [key: string]: unknown;
  };
  body: string;
  raw: string;
}

export interface Rule {
  name: string;
  severity: Severity;
  check: (content: SkillContent, path: string) => RuleResult | RuleResult[];
}
