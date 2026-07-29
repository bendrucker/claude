import { apStyleTitleCase } from "ap-style-title-case";
import type { Heading as MdastHeading, PhrasingContent } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { visit } from "unist-util-visit";

// AP lowercases conjunctions and prepositions of three letters or fewer. The
// library's shipped list misses `as`, `per`, `via`, and `vs`/`vs.` (versus); it
// splits on commas and colons but not periods, so `vs.` is one token.
//
// `up` is deliberately absent. It is a particle in the verb phrases that show up
// in headings (`Speed Up the Commit Hook`, `Follow-Up`), where AP capitalizes
// it. Listing it as a stopword made the checker rewrite correct headings down to
// `Speed up the Commit Hook`.
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
  "per",
  "so",
  "the",
  "to",
  "via",
  "vs",
  "vs.",
  "yet",
];

const STOPWORD_SET = new Set(AP_STOPWORDS);

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
// `IOS`). An internal capital marks those so they aren't re-cased.
function isIdentifier(segment: string): boolean {
  const letters = segment.replace(/[^A-Za-z]/g, "");
  if (letters.length < 2) return false;
  return /[A-Z]/.test(letters.slice(1));
}

// Anchored to the first character: an unanchored match uppercases the first
// letter wherever it sits, turning `3rd` into `3Rd`.
function capitalize(segment: string): string {
  return segment.replace(/^[a-z]/, (letter) => letter.toUpperCase());
}

// The library capitalizes both halves of a hyphenated compound only when it is
// the last word, so `Follow-up` became `Follow-Up` alone but `Follow-up Tasks`
// kept its lowercase half. AP capitalizes each element of a hyphenated compound
// regardless of position, so the segments are re-cased here rather than trusting
// the library's output for these words.
//
// Segments are handled independently so an acronym-led compound keeps its
// acronym and still fixes the rest: `CI-outage` -> `CI-Outage`. Treating the
// whole word as an identifier suppressed that fix entirely.
function caseHyphenated(original: string): string {
  return original
    .split("-")
    .map((segment, index) => {
      if (isIdentifier(segment)) return segment;
      if (index > 0 && STOPWORD_SET.has(segment.toLowerCase())) return segment.toLowerCase();
      return capitalize(segment);
    })
    .join("-");
}

// One word's AP casing: code spans and identifiers pass through untouched,
// hyphenated compounds get per-segment casing, everything else takes the
// library's position-aware result.
function caseWord(original: string, cased: string): string {
  if (original.includes(PLACEHOLDER)) return original;
  // A leading dash marks a CLI flag, which is a code token even unbackticked.
  // Casing it produces `--Format` and `-N`.
  if (original.startsWith("-")) return original;
  if (original.includes("-")) return caseHyphenated(original);
  if (isIdentifier(original)) return original;
  return cased;
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
      const result = caseWord(word, cased[i] ?? word);
      if (result !== word) differs = true;
      return result;
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
