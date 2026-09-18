// No-negation (Tottie, Negation in English Speech and Writing, 1991): the
// negation rides on a negative indefinite in object position ("carries no
// weight") where English would otherwise put it on the verb ("doesn't carry
// weight"). The governing verbs are an open set that shifts by model
// generation, so this keys on the grammar. The tagger supplies the word
// classes, and the closed residue it cannot read (predication verbs, idiom
// heads, the not-form's nonassertive forms and clause openers) lives in
// wordlists/negation/.
//
// Callers pass code-stripped text. collectMatches (tropes.ts) and scanAll
// (scan.ts) both run stripCode before invoking a pattern's test, and score.ts
// strips before its custom matcher, so importing stripCode here would only add
// a circular edge.

import { compromiseTagger } from "../linguistics/compromise";
import type { CoarseTag, TaggedToken } from "../linguistics/tags";
import { splitSentences } from "./sentences";
import type { PatternDef, PatternSpan } from "./tropes";
import { type Hits, WORDLISTS } from "./wordlists";

const INDEFINITES = new Set(["no", "none", "nothing", "nobody", "nowhere", "neither"]);
// "no" and "neither" determine a noun, so the head word completes the window.
const DETERMINERS = new Set(["no", "neither"]);

/** Closed classes take no object, so an indefinite after one is a quantified phrase or the next clause, never a negated object. */
const CLOSED_CLASSES: ReadonlySet<CoarseTag> = new Set([
  "DET",
  "PRON",
  "ADP",
  "CONJ",
  "AUX",
  "COPULA",
  "ADV",
  "PART",
  "NUM",
  "PUNCT",
  "CODE",
]);
/** Tags that premodify the noun a determiner opens ("no other instance"). */
const PREMODIFIERS: ReadonlySet<CoarseTag> = new Set(["ADJ", "ADV", "NUM"]);
/** Tags that sit between a bare indefinite and its verb ("nothing else moves", "nothing ever landed"). */
const SUBJECT_MODIFIERS: ReadonlySet<CoarseTag> = new Set(["ADV", "DET"]);

interface Located {
  token: TaggedToken;
  start: number;
  end: number;
}

/**
 * The tokens of one sentence with their character offsets into it. The tagger
 * splits hyphenated words, so the pieces are rejoined under the last piece's
 * tag ("one-shot", "no-op"), which also keeps "no-" out of the indefinites.
 */
function locate(sentence: string): Located[] {
  const located: Located[] = [];
  for (const token of compromiseTagger.tag(sentence).flatMap((tagged) => tagged.tokens)) {
    if (token.span === undefined) continue;
    const previous = located.at(-1);
    if (previous !== undefined && sentence.slice(previous.end, token.span.start) === "-") {
      const text = sentence.slice(previous.start, token.span.end);
      previous.token = { ...token, text, normal: text.toLowerCase() };
      previous.end = token.span.end;
      continue;
    }
    located.push({ token, ...token.span });
  }
  return located;
}

/** Whether only whitespace separates a token from the one before it. */
function adjacent(sentence: string, tokens: Located[], at: number): boolean {
  const previous = tokens[at - 1];
  const current = tokens[at];
  return (
    previous !== undefined &&
    current !== undefined &&
    sentence.slice(previous.end, current.start).trim() === ""
  );
}

function collapse(text: string): string {
  return text.replaceAll(/\s+/g, " ");
}

// A finite verb after the indefinite makes it the subject of an embedded
// clause ("means nothing is archived", "a repo no bot reviews"), which is
// obligatory no-negation. A determiner's noun phrase comes first: the head
// word whatever its tag ("no added ranges" tags the participle as a verb),
// further premodifiers, and one noun, since a second noun opens a relative
// clause on the object ("no glyph anyone would notice"). A past form that ends
// the phrase is a participle on that noun ("found no defects reported"), since
// a clause verb carries its own complement.
function opensClause(
  sentence: string,
  tokens: Located[],
  from: number,
  determiner: boolean,
): boolean {
  let at = from;
  if (determiner) {
    const headIsNoun = tokens[at]?.token.tag === "NOUN";
    if (adjacent(sentence, tokens, at)) at++;
    while (adjacent(sentence, tokens, at) && PREMODIFIERS.has(tokens[at]?.token.tag ?? "X")) at++;
    if (!headIsNoun && adjacent(sentence, tokens, at) && tokens[at]?.token.tag === "NOUN") at++;
  } else {
    while (adjacent(sentence, tokens, at) && SUBJECT_MODIFIERS.has(tokens[at]?.token.tag ?? "X"))
      at++;
  }
  const next = tokens[at];
  if (next === undefined || !adjacent(sentence, tokens, at)) return false;
  const { tag, finite, tense } = next.token;
  if (tag === "AUX" || tag === "COPULA") return true;
  if (!finite) return false;
  return !(determiner && tense === "past" && !adjacent(sentence, tokens, at + 1));
}

function sentenceSpans(sentence: string): PatternSpan[] {
  const tokens = locate(sentence);
  const spans: PatternSpan[] = [];
  for (const [at, indefinite] of tokens.entries()) {
    if (!INDEFINITES.has(indefinite.token.normal)) continue;
    const governor = tokens[at - 1];
    // Nothing governs a sentence-initial indefinite: subject position has no
    // not-negation counterpart, so it is obligatory rather than chosen.
    if (governor === undefined) continue;
    if (CLOSED_CLASSES.has(governor.token.tag)) continue;
    if (WORDLISTS.negation.predication.has(governor.token.normal)) continue;

    const determiner = DETERMINERS.has(indefinite.token.normal);
    const head = determiner && adjacent(sentence, tokens, at + 1) ? tokens[at + 1] : undefined;
    if (head !== undefined && WORDLISTS.negation.idioms.has(head.token.normal)) continue;
    if (opensClause(sentence, tokens, at + 1, determiner)) continue;

    const last = head ?? indefinite;
    spans.push({
      index: governor.start,
      matched: collapse(sentence.slice(governor.start, last.end)),
    });
  }
  return spans;
}

export function noNegationSpans(text: string): PatternSpan[] {
  const spans: PatternSpan[] = [];
  let cursor = 0;
  for (const sentence of splitSentences(text)) {
    const base = text.indexOf(sentence, cursor);
    if (base === -1) continue;
    cursor = base + sentence.length;
    for (const span of sentenceSpans(sentence)) {
      spans.push({ index: base + span.index, matched: span.matched });
    }
  }
  return spans;
}

export function noNegationHits(text: string): Hits {
  const spans = noNegationSpans(text);
  return { count: spans.length, sample: spans[0]?.matched ?? "" };
}

const NONASSERTIVE_WINDOW = 4;
const CLAUSE_BREAK = /[,;:()[\]–—]/;

/**
 * The not-negation counterpart, for the no:not ratio. A negated verb licenses
 * the nonassertive indefinite that follows it ("doesn't add anything"), so the
 * window runs forward from the negative particle and stops at a clause edge.
 */
export function notNegationHits(text: string): Hits {
  const samples: string[] = [];
  for (const sentence of splitSentences(text)) {
    const tokens = locate(sentence);
    const claimed = new Set<number>();
    for (const [at, cue] of tokens.entries()) {
      if (cue.token.tag !== "PART") continue;
      const licensed = nonassertiveAfter(sentence, tokens, at);
      if (licensed === undefined || claimed.has(licensed)) continue;
      claimed.add(licensed);
      // A contraction's negative half has no text of its own, so the sample
      // starts at its host ("doesn't").
      const from = cue.token.text === "" ? (tokens[at - 1]?.start ?? cue.start) : cue.start;
      samples.push(collapse(sentence.slice(from, tokens[licensed]?.end ?? cue.end)));
    }
  }
  return { count: samples.length, sample: samples[0] ?? "" };
}

/** Index of the first nonassertive indefinite within the window after the cue at `cueAt`. */
function nonassertiveAfter(sentence: string, tokens: Located[], cueAt: number): number | undefined {
  let previousEnd = tokens[cueAt]?.end ?? 0;
  let seen = 0;
  for (let at = cueAt + 1; at < tokens.length && seen < NONASSERTIVE_WINDOW; at++) {
    const current = tokens[at];
    if (current === undefined) return undefined;
    const before = sentence.slice(previousEnd, current.start);
    const after = sentence.slice(current.end, tokens[at + 1]?.start ?? sentence.length);
    // A comma-bounded word is a parenthetical ("doesn't, however, add"), not a
    // clause edge.
    if (before.includes(",") && after.includes(",")) {
      previousEnd = tokens[at + 1]?.start ?? current.end;
      continue;
    }
    if (CLAUSE_BREAK.test(before)) return undefined;
    const { normal, tag } = current.token;
    if (WORDLISTS.negation.nonassertive.has(normal)) return at;
    if (tag === "PUNCT" || WORDLISTS.negation.clauseOpeners.has(normal)) return undefined;
    previousEnd = current.end;
    seen++;
  }
  return undefined;
}

export const NO_NEGATION_PATTERN: PatternDef = {
  tier: "context",
  layer: "grammar",
  category: "no-negation",
  test: noNegationHits,
  spans: noNegationSpans,
  message: (matched) =>
    `"${matched}" puts the negation on the noun (no-negation). Give the positive term first ("a no-op", "unchanged", "the same"), and fall back to verb negation ("doesn't add anything") when the negation itself is the point.`,
  positives: [
    "The wrapper adds nothing to the default path.",
    "The tooltip surface holds no controls.",
    "The audit found no defects in the queue.",
    "Report no findings when the queue drains clean.",
    "The retry path returns none.",
    "That leaves no one to answer the page.",
  ],
  negatives: [
    "The build has no tests.",
    "There is no lock on the guard.",
    "Nothing changes when the flag is off.",
    "The list no longer needs an entry.",
    "It doesn't add anything the default lacks.",
    "The queue drains, and nothing else moves.",
    "Draining the queue is no small thing.",
    "A null here means nothing is archived under the window.",
    "The sweep skips work nobody performs twice.",
  ],
  evidence:
    "2026-09 session-corpus measurement over PR bodies, Write/Edit content, commit messages, and chat. The raw rate does not separate assistant prose from the human baseline, because both carry ordinary predication (has no tests, there is no lock). The no:not ratio does: on shared verbs assistant chat picks the no-form 4.4:1 against the human's 2.7:1, PR bodies reach 10:1, and for cost, say, show, find, and report the not-form never appears. 43% of 1,768 PR bodies carry an instance, and code comments run 2.67 per 1000 words. have forms supply 46% of raw hits and are Tottie's (1991) be/have exception, so they are excluded along with the other closed classes. compromise mis-tags the governing verb on this construction (holds, leaves, and cost come back as nouns), so the detector excludes governors by closed-class tag instead of requiring a verb tag, and reads the clause test off the tags after the indefinite. Calibration on 400 uniform-random hits from assistant chat and Write/Edit content, labeled in four rounds of 100 with each round drawn after the fixes the previous round motivated, using the lexical rule this tag-based rule replaced: precision 0.87, 0.90, 0.90, then 0.97 (Wilson 95% 0.92 to 0.99) on the final round. Re-scored over all 400 labels, the tag-based rule matches the lexical one (precision 0.958 against 0.955, recall 0.995 for both) without its 200-entry closed-class list or its irregular-past list. A separate 50-hit draw from the user role was 35 parts relayed agent text, so the human comparison comes from the voice corpus. The residual false positives are a governing noun the tagger cannot tell from a verb (a stage nothing enqueues) and a clause verb cut off by a code span. Of the true hits, a third have a ready positive term (a no-op, unchanged, empty), two thirds carry a negation that is the content and belongs on the verb.",
  retire:
    "Retire the pattern when the no_negation_share rate feature sits at the human voice baseline for a 30-day window. Add a governing word to wordlists/negation/predication.txt when writing:scan shows it flagging the human baseline at the assistant's rate.",
};
