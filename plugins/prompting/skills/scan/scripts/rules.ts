// Defects in a document a model executes. Each rule names a failure the
// `prompting` skill describes, so a finding maps to a rule the author can read.
//
// Rules run over mdast text nodes, which excludes fenced blocks and inline
// code. A prompt quoting a bad instruction as an example keeps the example.

import type { Text } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
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
    /\b(?:be (?:thorough|careful|concise|accurate|helpful|precise|diligent)|think (?:step by step|carefully|hard)|take your time|use your (?:best )?judg?ement|using your (?:best )?judg?ement|do your best|remember to|it(?:'s| is) important (?:to|that)|please|carefully)\b/gi,
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

// A quoted phrase is named rather than instructed, which is how a document
// about prompting teaches a rule by showing the wording it rejects. Blanking
// the span keeps every later offset in place.
function withoutQuotes(value: string): string {
  return value.replaceAll(/["“‘][^"”’]*["”’]/g, (quoted) => " ".repeat(quoted.length));
}

function patternFindings(node: Text): Finding[] {
  const found: Finding[] = [];
  const searchable = withoutQuotes(node.value);
  for (const rule of PATTERN_RULES) {
    for (const match of searchable.matchAll(rule.pattern)) {
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

// YAML frontmatter is data the harness reads, so it never carries instructions.
// Parsing it as markdown turns a `name: never-used` field into prose.
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;

/** Every finding in one document, ordered by position. */
export function scanPrompt(source: string): Finding[] {
  const found: Finding[] = [];
  const frontmatter = FRONTMATTER.exec(source)?.[0] ?? "";
  const offsetLines = frontmatter.length === 0 ? 0 : frontmatter.split("\n").length - 1;
  visit(fromMarkdown(source.slice(frontmatter.length)), "text", (node) => {
    found.push(...patternFindings(node));
  });
  for (const finding of found) finding.line += offsetLines;
  return found.toSorted((a, b) => (a.line === b.line ? a.col - b.col : a.line - b.line));
}

export const RULE_NAMES = PATTERN_RULES.map((rule) => rule.name);
