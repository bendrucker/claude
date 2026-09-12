// No-negation (Tottie, Negation in English Speech and Writing, 1991): the negation rides on a negative indefinite in object position ("carries no weight") where English would otherwise put it on the verb ("doesn't carry weight"). The governing verbs are an open set that shifts by model generation, so this keys on the grammar and excludes the cases human writing prefers in the no-form.
//
// Callers pass code-stripped text. collectMatches (tropes.ts) and scanAll (scan.ts) both run stripCode before invoking a pattern's test, and score.ts strips before its custom matcher, so importing stripCode here would only add a circular edge.

import { COPULA_FORMS } from "../linguistics/tags";
import { splitSentences } from "./sentences";
import type { PatternDef, PatternSpan } from "./tropes";
import type { Hits } from "./wordlists";

// "no one" is one indefinite, so it precedes the bare "no" alternative. A
// hyphen marks the positive term the message asks for ("a no-op"), not a
// negated object.
const INDEFINITE = /\b(?:no\s+one(?![\w-])|nothing|nobody|nowhere|none|neither|no(?!-))\b/gi;
const GOVERNING_WORD = /([A-Za-z]+(?:['’][A-Za-z]+)?)\s*$/;
const FOLLOWING_WORDS =
  /^(\s+[A-Za-z][A-Za-z'’-]*)(?:\s+([A-Za-z][A-Za-z'’-]*))?(?:\s+([A-Za-z][A-Za-z'’-]*))?/;
// "no" and "neither" determine a noun, so the head word completes the window.
const DETERMINER_INDEFINITE = /^(?:no|neither)$/i;

/** Tottie's exception: `be` and `have` take the no-form in plain predication ("has no tests", "there is no lock"). */
export const PREDICATION_GOVERNORS = new Set([
  ...COPULA_FORMS,
  "has",
  "have",
  "had",
  "having",
  "there",
]);

/** Closed classes take no object, so an indefinite after one is a quantified phrase or the next clause, never a negated object. */
export const CLOSED_CLASS_GOVERNORS = new Set([
  "a",
  "an",
  "the",
  "this",
  "that",
  "these",
  "those",
  "each",
  "every",
  "all",
  "some",
  "both",
  "any",
  "another",
  "other",
  "such",
  "few",
  "many",
  "much",
  "most",
  "several",
  "its",
  "their",
  "his",
  "her",
  "our",
  "my",
  "your",
  "i",
  "you",
  "he",
  "she",
  "it",
  "we",
  "they",
  "me",
  "him",
  "us",
  "them",
  "who",
  "whom",
  "whose",
  "which",
  "what",
  "there",
  "here",
  "itself",
  "themselves",
  "of",
  "in",
  "on",
  "at",
  "by",
  "for",
  "with",
  "from",
  "to",
  "into",
  "onto",
  "over",
  "under",
  "above",
  "below",
  "about",
  "across",
  "after",
  "before",
  "between",
  "through",
  "during",
  "without",
  "within",
  "against",
  "among",
  "beyond",
  "besides",
  "despite",
  "per",
  "via",
  "than",
  "like",
  "upon",
  "toward",
  "towards",
  "off",
  "out",
  "up",
  "down",
  "near",
  "past",
  "around",
  "along",
  "behind",
  "beside",
  "and",
  "or",
  "but",
  "nor",
  "so",
  "because",
  "since",
  "although",
  "though",
  "while",
  "whereas",
  "unless",
  "until",
  "when",
  "whenever",
  "where",
  "wherever",
  "if",
  "as",
  "whether",
  "not",
  "why",
  "how",
  "versus",
  "vs",
  "once",
  "however",
  "therefore",
  "thus",
  "hence",
  "plus",
  "can",
  "could",
  "will",
  "would",
  "shall",
  "should",
  "may",
  "might",
  "must",
  "ought",
  "almost",
  "nearly",
  "virtually",
  "still",
  "yet",
  "just",
  "only",
  "even",
  "also",
  "now",
  "otherwise",
  "quite",
  "rather",
  "very",
  "too",
  "again",
  "ever",
  "perhaps",
  "maybe",
  "indeed",
  "instead",
  "else",
  "alone",
]);

/** Assurance verbs take a clause complement ("confirmed no importer exists"), whose subject is the indefinite. */
export const CLAUSE_GOVERNORS = new Set([
  "confirm",
  "confirms",
  "confirmed",
  "confirming",
  "verify",
  "verifies",
  "verified",
  "verifying",
  "ensure",
  "ensures",
  "ensured",
  "ensuring",
  "assert",
  "asserts",
  "asserted",
  "asserting",
  "guarantee",
  "guarantees",
  "guaranteed",
  "sure",
]);

/** `no` in front of one of these heads an adverbial idiom, not a negated object. */
export const IDIOM_HEADS = new Set([
  "longer",
  "more",
  "further",
  "less",
  "fewer",
  "later",
  "sooner",
  "doubt",
  "matter",
  "way",
  "wonder",
  "different",
  "better",
  "worse",
  "greater",
  "bigger",
  "smaller",
  "larger",
  "shorter",
  "faster",
  "slower",
  "higher",
  "lower",
  "closer",
  "earlier",
  "wider",
  "narrower",
  "easier",
  "harder",
  "cheaper",
  "safer",
  "stronger",
  "weaker",
]);

/** Adverbs are open but suffixed, so the shape stands in for listing them. */
const ADVERB_SUFFIX = /ly$/;

/** A finite verb or auxiliary right after a bare indefinite makes it the subject of an embedded clause ("means nothing is archived", "work nobody performs"), which is obligatory no-negation. */
const AUXILIARIES = new Set([
  ...COPULA_FORMS,
  "has",
  "have",
  "had",
  "do",
  "does",
  "did",
  "can",
  "could",
  "will",
  "would",
  "shall",
  "should",
  "may",
  "might",
  "must",
]);
// -s and -ed are the finite verb shapes. Adjectives share the -s ending only
// through -ous, -ss, -us, and -is, and closed-class words ("as", "thus") are
// checked by the set instead of the shape.
const FINITE_VERB_SHAPE = /(?:[^osui]s|ed)$/i;
const PAST_VERB_SHAPE = /ed$/i;

// Adverbs sit between a subject and its verb ("nothing else does", "nothing
// ever landed"), so the clause test reads past them.
const SUBJECT_ADVERBS = new Set(["else", "ever", "never", "still", "yet", "even", "also", "just"]);

function isAdverb(word: string): boolean {
  return SUBJECT_ADVERBS.has(word) || ADVERB_SUFFIX.test(word);
}

function opensClause(words: (string | undefined)[], bare: boolean): boolean {
  const lowered = words.filter((word) => word !== undefined).map((word) => word.toLowerCase());
  const next = lowered.find((word) => !isAdverb(word));
  if (next === undefined) return false;
  if (AUXILIARIES.has(next)) return true;
  if (CLOSED_CLASS_GOVERNORS.has(next)) return false;
  // After a determiner head only the past shape is safe: "no new dispositions"
  // puts an -s noun after an adjective head, "no kind held" a verb.
  return bare ? FINITE_VERB_SHAPE.test(next) : PAST_VERB_SHAPE.test(next);
}

function isExcludedGovernor(word: string): boolean {
  const lower = word.toLowerCase();
  const base = lower.split(/['’]/)[0] ?? lower;
  const clitic = lower.slice(base.length).replaceAll("’", "'");
  return (
    PREDICATION_GOVERNORS.has(lower) ||
    PREDICATION_GOVERNORS.has(base) ||
    COPULA_FORMS.has(clitic) ||
    CLOSED_CLASS_GOVERNORS.has(lower) ||
    CLOSED_CLASS_GOVERNORS.has(base) ||
    CLAUSE_GOVERNORS.has(lower) ||
    ADVERB_SUFFIX.test(lower)
  );
}

function collapse(text: string): string {
  return text.replaceAll(/\s+/g, " ");
}

function sentenceSpans(sentence: string): PatternSpan[] {
  const spans: PatternSpan[] = [];
  for (const match of sentence.matchAll(INDEFINITE)) {
    const start = match.index;
    const governor = GOVERNING_WORD.exec(sentence.slice(0, start));
    // Nothing governs a sentence-initial indefinite: subject position has no
    // not-negation counterpart, so it is obligatory rather than chosen.
    if (governor === null) continue;
    if (isExcludedGovernor(governor[1] ?? "")) continue;

    const following = FOLLOWING_WORDS.exec(sentence.slice(start + match[0].length));
    const headToken = following?.[1] ?? "";
    const head = headToken === "" ? undefined : headToken.trim();
    const determiner = DETERMINER_INDEFINITE.test(match[0]);
    if (determiner && IDIOM_HEADS.has((head ?? "").toLowerCase())) continue;
    // A bare indefinite is the subject when a verb follows it. A determiner
    // form is the subject when an auxiliary follows its head ("no gate would").
    const afterIndefinite = determiner
      ? [following?.[2], following?.[3]]
      : [head, following?.[2], following?.[3]];
    if (opensClause(afterIndefinite, !determiner)) continue;

    const end = start + match[0].length + (determiner ? headToken.length : 0);
    spans.push({ index: governor.index, matched: collapse(sentence.slice(governor.index, end)) });
  }
  return spans;
}

export function noNegationSpans(text: string): PatternSpan[] {
  const spans: PatternSpan[] = [];
  let cursor = 0;
  for (const sentence of splitSentences(text)) {
    const base = text.indexOf(sentence, cursor);
    if (base < 0) continue;
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

const NOT_CUE = /\b(?:not|never|cannot)\b|n['’]t\b/gi;
const WORD_TOKEN = /[A-Za-z]+(?:['’][A-Za-z]+)?/g;
const NONASSERTIVE = new Set(["any", "anything", "anyone", "anywhere", "either"]);
const NONASSERTIVE_WINDOW = 4;

/**
 * The not-negation counterpart, for the no:not ratio. A negated verb licenses
 * the nonassertive indefinite that follows it ("doesn't add anything"), so the
 * window runs forward from the cue and stops at the sentence edge.
 */
export function notNegationHits(text: string): Hits {
  const samples: string[] = [];
  for (const sentence of splitSentences(text)) {
    for (const cue of sentence.matchAll(NOT_CUE)) {
      const licensed = nonassertiveAfter(sentence, cue.index + cue[0].length);
      if (licensed === undefined) continue;
      samples.push(collapse(sentence.slice(cue.index, licensed)));
    }
  }
  return { count: samples.length, sample: samples[0] ?? "" };
}

/** End offset of the first nonassertive indefinite within the window after `from`. */
function nonassertiveAfter(sentence: string, from: number): number | undefined {
  WORD_TOKEN.lastIndex = from;
  for (let seen = 0; seen < NONASSERTIVE_WINDOW; seen++) {
    const word = WORD_TOKEN.exec(sentence);
    if (word === null) return undefined;
    if (NONASSERTIVE.has(word[0].toLowerCase())) return word.index + word[0].length;
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
    "2026-09 session-corpus measurement over PR bodies, Write/Edit content, commit messages, and chat. The raw rate does not separate assistant prose from the human baseline, because both carry ordinary predication (has no tests, there is no lock). The no:not ratio does: on shared verbs assistant chat picks the no-form 4.4:1 against the human's 2.7:1, PR bodies reach 10:1, and for cost, say, show, find, and report the not-form never appears. 43% of 1,768 PR bodies carry an instance, and code comments run 2.67 per 1000 words. have forms supply 46% of raw hits and are Tottie's (1991) be/have exception, so they are excluded along with the other closed classes. Both taggers mis-tag the governing verb on this construction, which is why the detector decides it by closed-class exclusion instead. Calibration on 400 uniform-random hits from assistant chat and Write/Edit content, labeled in four rounds of 100 with each round drawn after the fixes the previous round motivated: precision 0.87, 0.90, 0.90, then 0.97 (Wilson 95% 0.92 to 0.99) on the final round. The residual false positive is a relative clause on the determiner form whose verb is irregular or -s (a repo no bot reviews), which needs the governor's part of speech. Of the true hits, a third have a ready positive term (a no-op, unchanged, empty), two thirds carry a negation that is the content and belongs on the verb.",
  retire:
    "Retire the pattern when the no_negation_share rate feature sits at the human voice baseline for a 30-day window. Add a governing word to CLOSED_CLASS_GOVERNORS when writing:scan shows it flagging the human baseline at the assistant's rate.",
};
