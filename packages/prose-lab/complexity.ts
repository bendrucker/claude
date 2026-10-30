import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { RegExpParser, visitRegExpAST } from "@eslint-community/regexpp";
import type { Alternative, CharacterClass, Element } from "@eslint-community/regexpp/ast";
import { parse } from "yaml";
import { z } from "zod";

/** A rule scoring past this is rewritten as an abstraction or left to a model judge. */
export const CEILING = 10;

export const WEIGHTS = {
  lookarounds: 3,
  gaps: 2,
  exceptionWords: 0.5,
  branches: 0.05,
  exceptions: 0.5,
  tokens: 0.1,
};

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
  return [
    ...(rule.tokens ?? []).flatMap((token) =>
      typeof token === "string" ? [token] : (token.pattern ?? []),
    ),
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

const lookaround = (kind: string) => kind === "lookahead" || kind === "lookbehind";

const parser = new RegExpParser({ ecmaVersion: 2025 });

function measurePattern(source: string, features: Features): void {
  const ast = parser.parsePattern(toJavaScript(source), undefined, undefined, { unicode: false });
  let negated = 0;
  const alternatives = (node: { alternatives: readonly Alternative[] }) => {
    const count = node.alternatives.length;
    if (count < 2) return;
    if (negated > 0) features.exceptionWords += count;
    else features.branches += count - 1;
  };
  visitRegExpAST(ast, {
    onPatternEnter: alternatives,
    onGroupEnter: alternatives,
    onCapturingGroupEnter: alternatives,
    onAssertionEnter: (node) => {
      if (!lookaround(node.kind)) return;
      features.lookarounds++;
      if ("negate" in node && node.negate) negated++;
      if ("alternatives" in node) alternatives(node);
    },
    onAssertionLeave: (node) => {
      if (lookaround(node.kind) && "negate" in node && node.negate) negated--;
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
  };
  for (const source of sources) measurePattern(source, features);
  const score =
    WEIGHTS.lookarounds * features.lookarounds +
    WEIGHTS.gaps * features.gaps +
    WEIGHTS.exceptionWords * features.exceptionWords +
    WEIGHTS.branches * features.branches +
    WEIGHTS.exceptions * features.exceptions +
    WEIGHTS.tokens * features.tokens;
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
    names.map(async (name) => {
      const { score, features } = measure(await Bun.file(join(styleDir, name)).text());
      return { rule: `${style}.${name.slice(0, -".yml".length)}`, score, features };
    }),
  );
}
