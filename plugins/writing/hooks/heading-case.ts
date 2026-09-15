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
  depth: number;
  text: string;
}

/**
 * A run of the combined heading text that came from one `text` node whose source
 * bytes read exactly as its value, so an offset inside the run maps straight back
 * into the body. A node carrying an escape or an entity renders shorter than it
 * is written and gets no span, which declines the rewrite for the words it holds.
 */
interface TextSpan {
  combinedStart: number;
  combinedEnd: number;
  sourceStart: number;
}

function reconstruct(
  body: string,
  children: PhrasingContent[],
): { combined: string; codeSpans: string[]; spans: TextSpan[] } {
  const parts: string[] = [];
  const codeSpans: string[] = [];
  const spans: TextSpan[] = [];
  let length = 0;
  const push = (text: string) => {
    parts.push(text);
    length += text.length;
  };
  const walk = (nodes: PhrasingContent[]) => {
    for (const node of nodes) {
      if (node.type === "inlineCode") {
        codeSpans.push(node.value);
        push(PLACEHOLDER);
      } else if (node.type === "text") {
        const start = node.position?.start.offset;
        const end = node.position?.end.offset;
        if (start !== undefined && end !== undefined && body.slice(start, end) === node.value) {
          spans.push({
            combinedStart: length,
            combinedEnd: length + node.value.length,
            sourceStart: start,
          });
        }
        push(node.value);
      } else if ("children" in node) {
        walk(node.children);
      } else if ("value" in node) {
        push(node.value);
      } else {
        // A node that renders as neither text nor code still separates the words
        // around it: a hard line break, an image, a footnote reference. Without a
        // separator the words on either side concatenate into one nonsense token,
        // which AP casing then reports as a suggestion matching nothing in the
        // body.
        push(" ");
      }
    }
  };
  walk(children);
  return { combined: parts.join(""), codeSpans, spans };
}

function restore(text: string, codeSpans: string[]): string {
  let i = 0;
  return text.replaceAll(PLACEHOLDER, () => `\`${codeSpans[i++]}\``);
}

// AP casing preserves all-caps acronyms on its own, but it title-cases
// identifiers with a lowercase first letter (`gitLab` -> `GitLab`, `iOS` ->
// `IOS`). An internal capital marks those so they aren't re-cased.
function isIdentifier(segment: string): boolean {
  const letters = segment.replaceAll(/[^A-Za-z]/g, "");
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

// A dot joining two segments marks a filename or config name, which is a code
// token even unbackticked and carries no internal capital to mark it:
// `global.css` became `Global.css` and `tmux.conf` became `Tmux.conf`.
//
// The dot must sit between two segments, with a lowercase alphanumeric one
// after it, so a trailing dot never marks a word: a heading ending in a period
// stays prose, and the AP stopword `vs.` keeps lowercasing. `e.g.` matches and
// is left as written, which is already its AP form. `U.S.` needs no dot rule
// because its internal capital marks it.
const DOTTED_IDENTIFIER = /[A-Za-z0-9]\.[a-z0-9]/;

// One word's AP casing: code spans and identifiers pass through untouched,
// hyphenated compounds get per-segment casing, everything else takes the
// library's position-aware result.
function caseWord(original: string, cased: string): string {
  if (original.includes(PLACEHOLDER)) return original;
  // A leading dash marks a CLI flag, which is a code token even unbackticked.
  // Casing it produces `--Format` and `-N`.
  if (original.startsWith("-")) return original;
  // Tested ahead of the hyphen split, which cases each segment on its own and
  // turned `ci-config.json` into `Ci-config.json`.
  if (DOTTED_IDENTIFIER.test(original)) return original;
  if (original.includes("-")) return caseHyphenated(original);
  if (isIdentifier(original)) return original;
  return cased;
}

interface ParsedHeading {
  children: PhrasingContent[];
  depth: number;
  combined: string;
  codeSpans: string[];
  spans: TextSpan[];
}

function parseHeadings(body: string): ParsedHeading[] {
  const tree = fromMarkdown(body);
  const headings: ParsedHeading[] = [];
  visit(tree, "heading", (node: MdastHeading) => {
    headings.push({
      children: node.children,
      depth: node.depth,
      ...reconstruct(body, node.children),
    });
  });
  return headings;
}

export function extractHeadings(body: string): Heading[] {
  return parseHeadings(body).map(({ children, depth, combined, codeSpans }) => ({
    children,
    depth,
    text: restore(combined.trim(), codeSpans),
  }));
}

export interface HeadingCaseViolation {
  text: string;
  suggested: string;
}

interface Correction {
  combinedStart: number;
  original: string;
  suggested: string;
}

interface Analysis {
  violation: HeadingCaseViolation;
  corrections: Correction[];
}

function analyze({ combined, codeSpans }: ParsedHeading): Analysis | null {
  const words = [...combined.matchAll(/\S+/g)];
  if (words.length === 0) return null;

  const trimmed = combined.trim();
  const cased = apStyleTitleCase(trimmed, { stopwords: AP_STOPWORDS }).trim().split(/\s+/);
  if (words.length !== cased.length) return null;

  const suggested: string[] = [];
  const corrections: Correction[] = [];
  for (const [i, match] of words.entries()) {
    const word = match[0];
    const next = caseWord(word, cased[i] ?? word);
    suggested.push(next);
    if (next !== word) {
      corrections.push({ combinedStart: match.index, original: word, suggested: next });
    }
  }
  if (corrections.length === 0) return null;

  return {
    violation: {
      text: restore(words.map((match) => match[0]).join(" "), codeSpans),
      suggested: restore(suggested.join(" "), codeSpans),
    },
    corrections,
  };
}

export function headingCaseViolations(body: string): HeadingCaseViolation[] {
  return parseHeadings(body)
    .map((heading) => analyze(heading)?.violation)
    .filter((violation): violation is HeadingCaseViolation => violation !== undefined);
}

interface Edit {
  start: number;
  end: number;
  text: string;
}

// A correction becomes an edit only when the whole word sits inside one verbatim
// `text` node, so the bytes replaced are the word and nothing else. A word split
// across a code span or an emphasis boundary, or held by a node carrying an
// escape or an entity, has no such span and declines.
function editFor(spans: TextSpan[], correction: Correction): Edit | null {
  const end = correction.combinedStart + correction.original.length;
  const span = spans.find(
    (candidate) =>
      correction.combinedStart >= candidate.combinedStart && end <= candidate.combinedEnd,
  );
  if (span === undefined) return null;
  const start = span.sourceStart + (correction.combinedStart - span.combinedStart);
  return { start, end: start + correction.original.length, text: correction.suggested };
}

// Every word of one heading, or null when any of them declines. A heading is
// corrected whole or not at all: correcting part of it would leave a deny whose
// reason no longer describes what is in the file.
function editsFor(heading: ParsedHeading, corrections: Correction[]): Edit[] | null {
  const edits: Edit[] = [];
  for (const correction of corrections) {
    const edit = editFor(heading.spans, correction);
    if (edit === null) return null;
    edits.push(edit);
  }
  return edits;
}

export interface HeadingCaseFix {
  /** The body with every applied heading rewritten and nothing else touched. */
  body: string;
  applied: HeadingCaseViolation[];
  /** Violations whose source the rewrite could not edit safely. */
  skipped: HeadingCaseViolation[];
}

export function correctHeadingCase(body: string): HeadingCaseFix {
  const applied: HeadingCaseViolation[] = [];
  const skipped: HeadingCaseViolation[] = [];
  const edits: Edit[] = [];
  for (const heading of parseHeadings(body)) {
    const analysis = analyze(heading);
    if (analysis === null) continue;
    const mapped = editsFor(heading, analysis.corrections);
    if (mapped === null) {
      skipped.push(analysis.violation);
      continue;
    }
    applied.push(analysis.violation);
    edits.push(...mapped);
  }

  // Back to front, so an earlier edit's replacement never shifts a later one's
  // offsets.
  let corrected = body;
  for (const edit of edits.toSorted((a, b) => b.start - a.start)) {
    corrected = corrected.slice(0, edit.start) + edit.text + corrected.slice(edit.end);
  }
  return { body: corrected, applied, skipped };
}
