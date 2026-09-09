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
  /** Source offsets of the whole heading, or -1 when the parse carried no position. */
  start: number;
  end: number;
}

function parseHeadings(body: string): ParsedHeading[] {
  const tree = fromMarkdown(body);
  const headings: ParsedHeading[] = [];
  visit(tree, "heading", (node: MdastHeading) => {
    const { combined, codeSpans } = reconstruct(node.children);
    headings.push({
      children: node.children,
      depth: node.depth,
      combined,
      codeSpans,
      start: node.position?.start.offset ?? -1,
      end: node.position?.end.offset ?? -1,
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

function violationFor({ combined, codeSpans }: ParsedHeading): HeadingCaseViolation | null {
  const trimmed = combined.trim();
  if (trimmed.length === 0) return null;

  const original = trimmed.split(/\s+/);
  const cased = apStyleTitleCase(trimmed, { stopwords: AP_STOPWORDS }).trim().split(/\s+/);
  if (original.length !== cased.length) return null;

  const suggested: string[] = [];
  let differs = false;
  for (const [i, word] of original.entries()) {
    const next = caseWord(word, cased[i] ?? word);
    suggested.push(next);
    if (next !== word) differs = true;
  }
  if (!differs) return null;

  return {
    text: restore(original.join(" "), codeSpans),
    suggested: restore(suggested.join(" "), codeSpans),
  };
}

export function headingCaseViolations(body: string): HeadingCaseViolation[] {
  return parseHeadings(body)
    .map(violationFor)
    .filter((violation): violation is HeadingCaseViolation => violation !== null);
}

// An ATX heading split into its `#` marker, its display text, and any closing
// `#` run. Trailing whitespace lands in the closing group because the text group
// is lazy.
const ATX_HEADING = /^(#{1,6}[ \t]+)(.*?)((?:[ \t]+#+)?[ \t]*)$/;

interface Edit {
  start: number;
  end: number;
  text: string;
}

// Offsets of the heading's display text, when the source is a plain ATX heading
// whose raw text reads the same as the text the violation reports. A setext
// heading, or one carrying emphasis, a link, or an escape, renders differently
// than it is written, so rewriting it by offset would drop the syntax around
// the words.
function textEdit(
  body: string,
  heading: ParsedHeading,
  violation: HeadingCaseViolation,
): Edit | null {
  if (heading.start < 0 || heading.end < 0) return null;
  const match = body.slice(heading.start, heading.end).match(ATX_HEADING);
  const marker = match?.[1];
  const content = match?.[2];
  if (marker === undefined || content === undefined) return null;
  const recased = recase(content, violation);
  if (recased === null) return null;
  const start = heading.start + marker.length;
  return { start, end: start + content.length, text: recased };
}

// The source heading with only its words re-cased. The violation reports a
// heading whose whitespace runs are each collapsed to one space, so writing it
// back verbatim would retype a double space or a tab the author wrote. Each run
// is copied from the source instead and only the words come from the
// suggestion, which keeps the correction to the case it claims to change.
// Null when the source does not word-for-word match the heading the violation
// reports, which is how a heading carrying emphasis, a link, or an escape
// declines the rewrite.
function recase(content: string, violation: HeadingCaseViolation): string | null {
  const source = content.split(/(\s+)/);
  const reported = violation.text.split(/(\s+)/);
  const suggested = violation.suggested.split(/(\s+)/);
  if (source.length !== reported.length || source.length !== suggested.length) return null;
  const out: string[] = [];
  for (const [i, chunk] of source.entries()) {
    const isGap = /^\s+$/.test(chunk);
    if (isGap !== /^\s+$/.test(reported[i] ?? "")) return null;
    if (isGap) {
      out.push(chunk);
      continue;
    }
    if (chunk !== reported[i]) return null;
    out.push(suggested[i] ?? chunk);
  }
  return out.join("");
}

export interface HeadingCaseFix {
  /** The body with every applied heading rewritten and nothing else touched. */
  body: string;
  applied: HeadingCaseViolation[];
  /** Violations whose source line the rewrite could not edit safely. */
  skipped: HeadingCaseViolation[];
}

export function correctHeadingCase(body: string): HeadingCaseFix {
  const applied: HeadingCaseViolation[] = [];
  const skipped: HeadingCaseViolation[] = [];
  const edits: Edit[] = [];
  for (const heading of parseHeadings(body)) {
    const violation = violationFor(heading);
    if (violation === null) continue;
    const edit = textEdit(body, heading, violation);
    if (edit === null) {
      skipped.push(violation);
      continue;
    }
    applied.push(violation);
    edits.push(edit);
  }

  let corrected = body;
  for (const edit of edits.toReversed()) {
    corrected = corrected.slice(0, edit.start) + edit.text + corrected.slice(edit.end);
  }
  return { body: corrected, applied, skipped };
}
