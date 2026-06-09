import type { HeadingKind } from "./heading";

/**
 * Committable, egress-clean heading fixtures for the regression gate in
 * `fixtures.test.ts`. Every example here is invented or drawn from
 * already-public sources (issue #769 and the committed examples in
 * `skills/analyze/references/linguistics.md`). None is quoted from any
 * private session corpus, so the suite is safe to commit and run in CI.
 *
 * The fixtures separate three concerns the writing plugin's heading hook
 * handles with different detectors:
 *
 * - `sentenceHeadingNegatives`: conventional heading shapes the sentence
 *   detector (`classifyHeadingBaseline`) must not flag. These are the
 *   false-positive ceiling: the precision gate asserts the baseline flags
 *   zero of them.
 * - `sentenceHeadingPositives`: invented sentence headings the detector
 *   should flag. Clause shapes are gated; imperatives are recorded, not
 *   gated, because the baseline misses most imperatives by design (~20%
 *   recall per linguistics.md).
 * - `titleCaseNegatives`: AP-correct headings the title-case checker must
 *   not flag. These exercise `checkTitleCase`, a separate detector from
 *   the sentence classifier.
 */

export interface SentenceHeadingFixture {
  description: string;
  heading: string;
  /** Expected verdict from `classifyHeadingBaseline`. */
  baselineFlagged: boolean;
  kind?: HeadingKind;
}

/**
 * The false-positive ceiling: conventional heading shapes documented in
 * the "Synthetic Corpus Results" section of linguistics.md, where ten
 * generated documents produced zero true sentence headings and the
 * baseline flagged none of these shapes. The candidate classifiers in
 * `classifiers.ts` flag several (tracked in the regression test); the
 * baseline must flag zero.
 */
export const sentenceHeadingNegatives: SentenceHeadingFixture[] = [
  {
    description: "decimal-numbered section heading",
    heading: "3.1 Unit Tests",
    baselineFlagged: false,
  },
  {
    description: "integer-numbered section heading",
    heading: "8. API Contract",
    baselineFlagged: false,
  },
  {
    description: "trailing-participle label",
    heading: "Lessons Learned",
    baselineFlagged: false,
  },
  {
    description: "colon-prefixed noun phrase",
    heading: "Testing Strategy: Payments Reconciliation Service",
    baselineFlagged: false,
  },
];

/**
 * Invented sentence headings the detector should flag. Clause-shaped
 * headings (subject plus linking verb, relative clause) are within the
 * baseline's reach and gated. Imperatives are recorded with the
 * baseline's actual verdict: the nine-opener word set catches a few and
 * misses the rest by design, so these document current recall rather
 * than gate it.
 */
export const sentenceHeadingPositives: SentenceHeadingFixture[] = [
  {
    description: "subject plus linking verb (is)",
    heading: "Throughput Is the Limiting Factor",
    baselineFlagged: true,
    kind: "clause",
  },
  {
    description: "subject plus linking verb (holds)",
    heading: "The Queue Holds Every Pending Job",
    baselineFlagged: true,
    kind: "clause",
  },
  {
    description: "relative clause with that",
    heading: "Failures That Cascade Through the Mesh",
    baselineFlagged: true,
    kind: "clause",
  },
  {
    description: "imperative opener in the word set (configure)",
    heading: "Configure the Retry Budget Before Launch",
    baselineFlagged: true,
    kind: "imperative",
  },
  {
    description: "imperative opener in the word set (add)",
    heading: "Add a Circuit Breaker to the Gateway",
    baselineFlagged: true,
    kind: "imperative",
  },
  {
    description: "imperative opener in the word set (implement)",
    heading: "Implement the Idempotency Key Check",
    baselineFlagged: true,
    kind: "imperative",
  },
  {
    description: "imperative opener outside the word set (baseline miss)",
    heading: "Throttle the Webhook Fan-Out at the Edge",
    baselineFlagged: false,
    kind: "noun-phrase",
  },
  {
    description: "imperative opener outside the word set (baseline miss)",
    heading: "Validate the Payload Against the Schema",
    baselineFlagged: false,
    kind: "noun-phrase",
  },
];

export interface TitleCaseFixture {
  description: string;
  heading: string;
}

/**
 * AP-correct headings the title-case checker must not flag, recorded as a
 * regression fixture in issue #769. Both lowercase the AP function words
 * `as`, `an`, `the`, `to`, `and`, and `vs.` and capitalize the adverb
 * `Not`; ap-style-title-case's default stopword list omits `as` and `vs.`,
 * so the checker flagged both until the hook passed an extended list.
 */
export const titleCaseNegatives: TitleCaseFixture[] = [
  {
    description: "lowercase as after a noun, lowercase an, capitalized Not after comma",
    heading: "The Tagger Comparison as an Eval Device, Not the Architecture",
  },
  {
    description: "lowercase to and and, lowercase vs. with trailing period",
    heading: "Relationship to Other Issues, and What to Hold vs. Do Ad Hoc",
  },
];

/**
 * Headings with genuinely incorrect casing, kept so the title-case fix
 * does not regress the checker's real job: these must still be flagged.
 */
export const titleCasePositives: TitleCaseFixture[] = [
  {
    description: "all lowercase",
    heading: "deployment topology",
  },
  {
    description: "lowercase major word mid-heading",
    heading: "Retry budget and Backoff",
  },
  {
    description: "lowercase word adjacent to a comma that is not a function word",
    heading: "Latency, throughput, and Saturation",
  },
];
