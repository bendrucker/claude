// Defects in a document a model executes. Each rule names a failure the
// `prompting` skill describes, so a finding maps to a rule the author can read.
//
// Rules run over mdast text nodes, which excludes fenced blocks, inline code,
// and frontmatter. A prompt quoting a bad instruction as an example keeps the
// example.

import type { Nodes, Root, Text } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { frontmatterFromMarkdown } from "mdast-util-frontmatter";
import { frontmatter } from "micromark-extension-frontmatter";
import { visit } from "unist-util-visit";

export interface Finding {
  line: number;
  col: number;
  rule: string;
  message: string;
  match: string;
}

interface PatternRule {
  name: string;
  message: string;
  pattern: RegExp;
}

// The document reads as advice, so whether it fires is left to the run.
const WEAK_MODALITY: PatternRule = {
  name: "weak-modality",
  message: "softens an instruction into a suggestion. State the instruction.",
  pattern:
    /\b(?:try to|feel free to|if possible|if necessary|as needed|(?:where|when|as) appropriate|you (?:may|might|could) want to|it(?:'s| is) (?:a good idea|often best|usually best|generally best) to|consider \w+ing)\b/gi,
};

// The model decides for itself when the work is done. See Completion
// Criteria in the prompting skill.
const VAGUE_CRITERION: PatternRule = {
  name: "vague-criterion",
  message: "is a bound the model cannot check. Name the observable done-state.",
  pattern:
    /\b(?:make sure|properly|correctly|appropriately|adequately|sufficiently|as much as (?:possible|needed)|if it makes sense|when (?:done|finished)|until satisfied)\b/gi,
};

const NO_OP: PatternRule = {
  name: "no-op",
  message: "restates a default the model already follows. Delete the sentence.",
  pattern:
    /\b(?:be (?:thorough|careful|concise|accurate|helpful|precise|diligent)|think (?:step by step|carefully|hard)|take your time|(?:use|using) your (?:best )?judge?ment|do your best|remember to|it(?:'s| is) important (?:to|that)|please|carefully)\b/gi,
};

const PATTERN_RULES = [WEAK_MODALITY, VAGUE_CRITERION, NO_OP];

/** Line and column of an offset within a text node, in source coordinates. */
function locate(node: Text, offset: number): { line: number; col: number } {
  const start = node.position?.start;
  if (!start) return { line: 0, col: 0 };
  const before = node.value.slice(0, offset);
  const lastBreak = before.lastIndexOf("\n");
  if (lastBreak === -1) return { line: start.line, col: start.column + offset };
  return {
    line: start.line + (before.split("\n").length - 1),
    col: before.length - lastBreak,
  };
}

// Each opener pairs with its own closer, so a stray quote exempts nothing
// beyond itself.
const QUOTED = /"[^"]*"|“[^”]*”|‘[^’]*’/g;

type Span = readonly [number, number];

// Paragraphs and headings are where prose lives. Pairing runs inside one of
// them at a time, so an unmatched quote reaches the end of its own block and
// no further.
const BLOCKS = new Set(["paragraph", "heading", "tableCell"]);

// One block's prose, with every character outside a text node replaced by a
// space: formatting marks, inline code, and the delimiters mdast consumed. The
// spaces hold each source offset in place, and dropping inline code keeps a
// quote in `a "b` from pairing with one in the sentence around it.
function proseView(source: string, block: Nodes): string {
  const from = block.position?.start.offset;
  const to = block.position?.end.offset;
  if (from === undefined || to === undefined) return "";
  const chars: string[] = Array.from({ length: to - from }, () => " ");
  visit(block, "text", (node) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) return;
    for (let i = start; i < end; i++) chars[i - from] = source.charAt(i);
  });
  return chars.join("");
}

// A quoted phrase is named, which is how a document about prompting teaches a
// rule by showing the wording it rejects. Pairing across the whole block exempts
// a quote that formatting splits into sibling nodes, such as "*be thorough*".
function quotedSpans(source: string, tree: Root): Span[] {
  const spans: Span[] = [];
  visit(tree, (block) => {
    if (!BLOCKS.has(block.type)) return;
    const from = block.position?.start.offset ?? 0;
    for (const match of proseView(source, block).matchAll(QUOTED)) {
      spans.push([from + match.index, from + match.index + match[0].length]);
    }
  });
  return spans;
}

function patternFindings(node: Text, quoted: readonly Span[]): Finding[] {
  const offset = node.position?.start.offset ?? 0;
  const found: Finding[] = [];
  for (const rule of PATTERN_RULES) {
    for (const match of node.value.matchAll(rule.pattern)) {
      const at = offset + match.index;
      if (quoted.some(([from, to]) => at >= from && at < to)) continue;
      found.push({
        ...locate(node, match.index),
        rule: rule.name,
        message: `"${match[0]}" ${rule.message}`,
        match: match[0],
      });
    }
  }
  return found;
}

// Frontmatter is data the harness reads, so it never carries instructions. The
// extension gives it a node of its own, which holds no text children and so
// never reaches the rules, and every other node keeps its true source position.
function parse(source: string): Root {
  return fromMarkdown(source, {
    extensions: [frontmatter(["yaml", "toml"])],
    mdastExtensions: [frontmatterFromMarkdown(["yaml", "toml"])],
  });
}

/** Every finding in one document, ordered by position. */
export function scanPrompt(source: string): Finding[] {
  const tree = parse(source);
  const quoted = quotedSpans(source, tree);
  const found: Finding[] = [];
  visit(tree, "text", (node) => {
    found.push(...patternFindings(node, quoted));
  });
  return found.toSorted((a, b) => (a.line === b.line ? a.col - b.col : a.line - b.line));
}
