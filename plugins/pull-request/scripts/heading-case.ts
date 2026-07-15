import { apStyleTitleCase } from "ap-style-title-case";
import type { Heading as MdastHeading, PhrasingContent } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { visit } from "unist-util-visit";

// ap-style-title-case ships a stopword list missing two words AP lowercases:
// `as` (a short conjunction/preposition) and `vs`/`vs.` (versus). The library
// splits on commas and colons but not periods, so `vs.` is one token.
const AP_STOPWORDS = [
  "a",
  "an",
  "and",
  "as",
  "at",
  "but",
  "by",
  "for",
  "in",
  "nor",
  "of",
  "on",
  "or",
  "so",
  "the",
  "to",
  "up",
  "vs",
  "vs.",
  "yet",
];

// A single Private Use Area codepoint stands in for each inline-code span while
// AP casing runs. It carries no whitespace, so it reads as one word and keeps
// the code span's position (first/last-word rules stay correct), and it is never
// a stopword, so casing leaves it untouched.
const PLACEHOLDER = String.fromCharCode(0xe000);

export interface Heading {
  children: PhrasingContent[];
  text: string;
}

function reconstruct(children: PhrasingContent[]): { combined: string; codeSpans: string[] } {
  const parts: string[] = [];
  const codeSpans: string[] = [];
  const walk = (nodes: PhrasingContent[]) => {
    for (const node of nodes) {
      if (node.type === "inlineCode") {
        codeSpans.push(node.value);
        parts.push(PLACEHOLDER);
      } else if (node.type === "text") {
        parts.push(node.value);
      } else if ("children" in node) {
        walk(node.children);
      } else if ("value" in node) {
        parts.push(node.value);
      }
    }
  };
  walk(children);
  return { combined: parts.join(""), codeSpans };
}

function restore(text: string, codeSpans: string[]): string {
  let i = 0;
  return text.replaceAll(PLACEHOLDER, () => `\`${codeSpans[i++]}\``);
}

// AP casing preserves all-caps acronyms on its own, but it title-cases
// identifiers with a lowercase first letter (`gitLab` -> `GitLab`, `iOS` ->
// `IOS`). Skip any word with an internal capital so those aren't re-cased.
function isIdentifier(word: string): boolean {
  const letters = word.replace(/[^A-Za-z]/g, "");
  if (letters.length < 2) return false;
  return /[A-Z]/.test(letters.slice(1));
}

interface ParsedHeading {
  children: PhrasingContent[];
  combined: string;
  codeSpans: string[];
}

function parseHeadings(body: string): ParsedHeading[] {
  const tree = fromMarkdown(body);
  const headings: ParsedHeading[] = [];
  visit(tree, "heading", (node: MdastHeading) => {
    const { combined, codeSpans } = reconstruct(node.children);
    headings.push({ children: node.children, combined, codeSpans });
  });
  return headings;
}

export function extractHeadings(body: string): Heading[] {
  return parseHeadings(body).map(({ children, combined, codeSpans }) => ({
    children,
    text: restore(combined.trim(), codeSpans),
  }));
}

export function headingCaseViolations(body: string): { text: string; suggested: string }[] {
  const violations: { text: string; suggested: string }[] = [];
  for (const { combined, codeSpans } of parseHeadings(body)) {
    const trimmed = combined.trim();
    if (trimmed.length === 0) continue;

    const original = trimmed.split(/\s+/);
    const cased = apStyleTitleCase(trimmed, { stopwords: AP_STOPWORDS }).trim().split(/\s+/);
    if (original.length !== cased.length) continue;

    let differs = false;
    const suggested = original.map((word, i) => {
      if (word.includes(PLACEHOLDER) || isIdentifier(word)) return word;
      if (word !== cased[i]) differs = true;
      return cased[i];
    });

    if (differs) {
      violations.push({
        text: restore(original.join(" "), codeSpans),
        suggested: restore(suggested.join(" "), codeSpans),
      });
    }
  }
  return violations;
}
