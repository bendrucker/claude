import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { RegExpParser, visitRegExpAST } from "@eslint-community/regexpp";
import type { CharacterClass, Element } from "@eslint-community/regexpp/ast";
import { parse } from "yaml";
import { z } from "zod";

/** A rule scoring past this is rewritten as an abstraction or left to a model judge. */
export const CEILING = 10;

/** Points per feature. Fit them against the user's ratings, which `rules` reports agreement with. */
export const WEIGHTS = {
  lookarounds: 3,
  gaps: 2,
  exceptionWords: 0.5,
  branches: 0.05,
  exceptions: 0.5,
  tokens: 0.1,
  overLength: 0.01,
};

const LENGTH_ALLOWANCE = 200;

export interface Features {
  lookarounds: number;
  /** Quantified wildcards that can span words, such as `.*` or `[\w\s]{0,40}`. */
  gaps: number;
  /** Alternatives inside a negative lookaround: exceptions hand-listed into the pattern. */
  exceptionWords: number;
  branches: number;
  /** Entries in the rule's `exceptions:` list. */
  exceptions: number;
  tokens: number;
  chars: number;
  /** Patterns the parser rejected, which no feature counts. */
  unparsed: number;
}

export interface Complexity {
  score: number;
  features: Features;
}

const Rule = z.object({
  tokens: z.array(z.union([z.string(), z.object({ pattern: z.string().optional() })])).optional(),
  token: z.string().optional(),
  raw: z.array(z.string()).optional(),
  swap: z.record(z.string(), z.unknown()).optional(),
  exceptions: z.array(z.string()).optional(),
});

function patterns(rule: z.infer<typeof Rule>): string[] {
  const tokens = (rule.tokens ?? []).flatMap((token) => {
    if (typeof token === "string") return [token];
    return token.pattern === undefined ? [] : [token.pattern];
  });
  return [
    ...tokens,
    ...(rule.token === undefined ? [] : [rule.token]),
    ...(rule.raw ?? []),
    ...Object.keys(rule.swap ?? {}),
  ];
}

/** Rewrites the Go-flavored syntax Vale accepts into a pattern a JavaScript parser reads. */
function toJavaScript(source: string): string {
  return source
    .replaceAll(/\(\?[imsx]+\)/g, "")
    .replaceAll(/\(\?[imsx]+:/g, "(?:")
    .replaceAll("(?P<", "(?<")
    .replaceAll(String.raw`\A`, "^")
    .replaceAll(/\\[zZ]/g, "$");
}

function spansWords(element: Element): boolean {
  if (element.type === "CharacterSet") return element.kind === "any";
  if (element.type !== "CharacterClass") return false;
  const cls: CharacterClass = element;
  if (cls.negate) return true;
  // A gap must match both letters and spaces, or it only consumes separators like `[\s-]+`.
  const space = cls.elements.some(
    (member) => member.type === "CharacterSet" && member.kind === "space" && !member.negate,
  );
  const letters = cls.elements.some(
    (member) =>
      member.type === "CharacterClassRange" ||
      (member.type === "CharacterSet" && member.kind === "word" && !member.negate),
  );
  return space && letters;
}

const parser = new RegExpParser({ ecmaVersion: 2025 });

function measurePattern(source: string, features: Features): void {
  const ast = parser.parsePattern(toJavaScript(source), undefined, undefined, { unicode: false });
  let negated = 0;
  const alternatives = (count: number) => {
    if (count < 2) return;
    if (negated > 0) features.exceptionWords += count;
    else features.branches += count - 1;
  };
  visitRegExpAST(ast, {
    onPatternEnter: (node) => {
      alternatives(node.alternatives.length);
    },
    onGroupEnter: (node) => {
      alternatives(node.alternatives.length);
    },
    onCapturingGroupEnter: (node) => {
      alternatives(node.alternatives.length);
    },
    onAssertionEnter: (node) => {
      if (node.kind !== "lookahead" && node.kind !== "lookbehind") return;
      features.lookarounds++;
      if (node.negate) negated++;
      alternatives(node.alternatives.length);
    },
    onAssertionLeave: (node) => {
      if ((node.kind === "lookahead" || node.kind === "lookbehind") && node.negate) negated--;
    },
    onQuantifierEnter: (node) => {
      if (node.max > 1 && spansWords(node.element)) features.gaps++;
    },
  });
}

/** Scores a Vale rule's YAML by the pattern features that make it hard to maintain. */
export function measure(yaml: string): Complexity {
  const rule = Rule.parse(parse(yaml));
  const sources = patterns(rule);
  const features: Features = {
    lookarounds: 0,
    gaps: 0,
    exceptionWords: 0,
    branches: 0,
    exceptions: rule.exceptions?.length ?? 0,
    tokens: sources.length,
    chars: sources.reduce((sum, source) => sum + source.length, 0),
    unparsed: 0,
  };
  for (const source of sources) {
    try {
      measurePattern(source, features);
    } catch {
      features.unparsed++;
    }
  }
  const score =
    WEIGHTS.lookarounds * features.lookarounds +
    WEIGHTS.gaps * features.gaps +
    WEIGHTS.exceptionWords * features.exceptionWords +
    WEIGHTS.branches * features.branches +
    WEIGHTS.exceptions * features.exceptions +
    WEIGHTS.tokens * features.tokens +
    WEIGHTS.overLength * Math.max(0, features.chars - LENGTH_ALLOWANCE);
  return { score: Math.round(score * 10) / 10, features };
}

export interface RuleComplexity extends Complexity {
  /** The check name, `Style.Rule`. */
  rule: string;
}

/** Each rule in a style directory with its complexity. */
export async function styleRules(styleDir: string, style: string): Promise<RuleComplexity[]> {
  const names = (await readdir(styleDir)).filter((name) => name.endsWith(".yml")).toSorted();
  return Promise.all(
    names.map(async (name) =>
      Object.assign(measure(await Bun.file(join(styleDir, name)).text()), {
        rule: `${style}.${name.slice(0, -".yml".length)}`,
      }),
    ),
  );
}
