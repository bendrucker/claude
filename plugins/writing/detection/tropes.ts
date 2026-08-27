import { isProseFile } from "./paths";
import { splitParagraphs, splitSentences } from "./sentences";
import {
  type Hits,
  type StemmedWeight,
  stemmedPhraseHits,
  WORDLISTS,
  weightedStemHits,
} from "./wordlists";

export type PatternTier = "deny" | "context";

export type ScanContext = "file" | "sideEffect";

export type PatternMatch = {
  tier: PatternTier;
  category: string;
  matched: string;
  message: string;
  structural: boolean;
};

export type DetectorLayer = "vocabulary" | "grammar" | "cross-sentence" | "meaning";

export type PatternDef = {
  tier: PatternTier;
  layer: DetectorLayer;
  category: string;
  test: RegExp | ((text: string) => Hits);
  message: (matched: string) => string;
  fileOnly?: boolean;
  sideEffectOnly?: boolean;
  structural?: boolean;
  /**
   * When true, this pattern ships in the batch analyze/review/score surfaces
   * only. The hook never runs it. Hook promotion is an explicit user checkpoint.
   */
  skillOnly?: boolean;
  /** Invented examples that must match this pattern. Never quoted from sessions. */
  positives: string[];
  /** Invented examples that must not match this pattern. Never quoted from sessions. */
  negatives: string[];
  /** What corpus evidence earned this pattern's place in the hook. */
  evidence: string;
  /** Corpus condition under which this pattern should be retired. */
  retire: string;
};

export type WeightedPatternGroup = {
  tier: PatternTier;
  layer: DetectorLayer;
  category: string;
  entries: StemmedWeight[];
  threshold: number;
  message: (matchedExamples: string[], totalWeight: number) => string;
  fileOnly?: boolean;
  evidence: string;
  retire: string;
};

const FENCED_CODE_BLOCK = /```[\s\S]*?```/g;
const INLINE_CODE = /`[^`]+`/g;

const DETERMINERS = /^(?:the|a|an|it|them|this|that|its)\b/i;

const RESULT_SENTENCES = [
  /\b(?:all\s+)?\d+(?:\/\d+)?\s+(?:\w+\s+)*(?:pass|fail|succeed)/i,
  /\b(?:all|every|both)\s+(?:\w+\s+)*(?:pass(?:es|ed|ing)?|green)/i,
  /\b(?:0|zero)\s+(?:errors?|failures?|warnings?)\b/i,
  /\b\S+\s+(?:(?:is|are)\s+)?(?:now\s+)?(?:green|clean)\b/i,
  /\bonce\s+\S+\s+pass/i,
  /^(?:\w+\s+){0,3}pass(?:es|ed|ing)?(?:\s|$)/im,
];

// "no X needed" is a marketing brag when X is an artifact the design lacks
// ("no config needed"), but a legitimate status report when X is an action that
// was not required ("no change needed"). The artifact side is open-ended, so we
// flag the construction and carve out the status side, whose vocabulary is
// concentrated: function words, deverbal nouns (-tion/-sion/-ment), and dev
// actions. A determiner in the gap marks a clause boundary ("no way the runtime
// needed ..."), not an intervening adjective.
const NO_X_CONSTRUCTION = /\bno\s+((?:\w+\s+){0,3}?)(\w+)\s+(?:needed|required|necessary)\b/gi;
const NO_X_FUNCTION_WORDS = new Set([
  "longer",
  "more",
  "further",
  "additional",
  "extra",
  "fewer",
  "less",
  "other",
]);
const NO_X_ACTION_WORDS = new Set([
  "change",
  "changes",
  "fix",
  "fixes",
  "edit",
  "edits",
  "work",
  "move",
  "moves",
  "update",
  "updates",
  "override",
  "overrides",
  "touch",
  "tweak",
  "tweaks",
  "patch",
  "patches",
  "bump",
  "bumps",
  "swap",
  "swaps",
  "merge",
  "merges",
  "sync",
  "run",
  "runs",
  "check",
  "checks",
  "review",
  "reviews",
  "test",
  "tests",
  "cleanup",
  "dedup",
  "retry",
  "retries",
  "rebuild",
  "rebase",
  "restack",
  "restart",
  "reload",
  "resize",
  "reorder",
  "recompile",
  "redeploy",
  "reinstall",
  "rerun",
  "refactor",
]);
const DEVERBAL_NOUN = /(?:tion|sion|ment)s?$/i;

function isStatusHead(head: string): boolean {
  const word = head.toLowerCase();
  return NO_X_FUNCTION_WORDS.has(word) || NO_X_ACTION_WORDS.has(word) || DEVERBAL_NOUN.test(word);
}

function noXNeededHits(text: string): Hits {
  for (const match of text.matchAll(NO_X_CONSTRUCTION)) {
    const gap = match[1] ?? "";
    const head = match[2] ?? "";
    if (gap.split(/\s+/).some((token) => DETERMINERS.test(token))) continue;
    if (isStatusHead(head)) continue;
    return { count: 1, sample: match[0].trim() };
  }
  return { count: 0, sample: "" };
}

function testResultHits(text: string): Hits {
  for (const sentence of text.split(/[.!?\n]+/)) {
    const s = sentence.trim();
    for (const pattern of RESULT_SENTENCES) {
      pattern.lastIndex = 0;
      const match = pattern.exec(s);
      if (!match) continue;
      const after = s.slice(match.index + match[0].length).trim();
      if (DETERMINERS.test(after)) continue;
      return { count: 1, sample: match[0] };
    }
  }
  return { count: 0, sample: "" };
}

const CLAUSE_CONNECTOR = /;|—|[A-Za-z] [-–] [A-Za-z]/;
const LIST_ITEM = /^(?:[-*+]|\d+[.)])\s/;
const MIN_SENTENCES = 5;
const MIN_CONNECTOR_SENTENCES = 3;
const CONNECTOR_DENSITY = 0.3;

// In a list item a dash usually separates a label from its gloss (`- **term** — gloss`)
// rather than joining two clauses, so only a semicolon counts as a connector there.
function isConnectorSentence(sentence: string): boolean {
  if (LIST_ITEM.test(sentence)) return sentence.includes(";");
  return CLAUSE_CONNECTOR.test(sentence);
}

function connectorDensityHits(text: string): Hits {
  const sentences = splitSentences(text).filter((s) => s.split(/\s+/).length >= 4);
  if (sentences.length < MIN_SENTENCES) return { count: 0, sample: "" };
  const connected = sentences.filter(isConnectorSentence);
  if (connected.length < MIN_CONNECTOR_SENTENCES) return { count: 0, sample: "" };
  if (connected.length / sentences.length < CONNECTOR_DENSITY) return { count: 0, sample: "" };
  const first = connected[0] ?? "";
  const i = CLAUSE_CONNECTOR.exec(first)?.index ?? 0;
  return { count: connected.length, sample: first.slice(Math.max(0, i - 20), i + 24).trim() };
}

// A splice joins clauses with "; " where letters flank the boundary. The
// letter guards keep commented-out code (`foo(); bar()`), digit-led references
// ("2; see below"), and bare separators from counting as clause joins. List
// items are skipped: their semicolons usually separate enumerated fragments,
// and connector density already covers dense list semicolons.
const SEMICOLON_SPLICE = /[a-z]; [a-z]/i;
const PROSE_SPLICE_MIN = 2;

export function semicolonSpliceHits(text: string, minSplices: number): Hits {
  const spliced = splitSentences(text).filter(
    (s) => !LIST_ITEM.test(s) && SEMICOLON_SPLICE.test(s),
  );
  if (spliced.length < minSplices) return { count: 0, sample: "" };
  const first = spliced[0] ?? "";
  const i = SEMICOLON_SPLICE.exec(first)?.index ?? 0;
  return { count: spliced.length, sample: first.slice(Math.max(0, i - 20), i + 24).trim() };
}

const openerPatterns: PatternDef[] = WORDLISTS.openers
  ? [
      {
        tier: "deny",
        layer: "vocabulary",
        category: "sycophantic opener",
        test: WORDLISTS.openers,
        sideEffectOnly: true,
        message: (matched: string) =>
          `"${matched.trim()}" reads as a sycophantic opener. Open with the substance.`,
        positives: ["Excellent! Moving on.", "Excellent. That settles it."],
        negatives: [
          "An excellent question to consider.",
          "It is great that the migration shipped.",
        ],
        evidence:
          "Openers list curated from corpus. Entries are plain-word matches at line start, reviewed for false-positive rate against normal prose.",
        retire:
          "Remove individual openers when they no longer appear in assistant side-effect outputs or when corrective-feedback moments stop citing them.",
      },
    ]
  : [];

// Adversative negation-flip: sentence N contains a negation cue and sentence N+1
// opens with an adversative conjunction. This signals the cross-sentence
// contrast structure. Pure regex, two-sentence sliding window.
const NEGATION_CUE = /\b(?:not|never)\b|\bno\s|n't\b/i;
const ADVERSATIVE_OPENER = /^\s*(?:However|But|Yet|Nevertheless|Nonetheless|Still|That said),?\s/i;

function adversativeNegationFlipHits(text: string): Hits {
  const sentences = splitSentences(text);
  for (let i = 0; i < sentences.length - 1; i++) {
    const current = sentences[i] ?? "";
    const next = sentences[i + 1] ?? "";
    if (NEGATION_CUE.test(current) && ADVERSATIVE_OPENER.test(next)) {
      return { count: 1, sample: `${current.slice(0, 60)} / ${next.slice(0, 40)}` };
    }
  }
  return { count: 0, sample: "" };
}

// Question-then-answer cadence: 2 of 4+ paragraphs open with a question.
// Pure regex. Lower precision, near-zero cost.
const MIN_PARAGRAPHS_FOR_QA = 4;
const QA_QUESTION_THRESHOLD = 2;
// Matches question-opening sentences after splitSentences strips the trailing '?'.
const QUESTION_OPENER =
  /^\s*(?:What|Why|How|When|Where|Who|Which|Is|Are|Does|Do|Can|Should|Could|Would|Will)\b/i;

function questionAnswerCadenceHits(text: string): Hits {
  const paragraphs = splitParagraphs(text);
  if (paragraphs.length < MIN_PARAGRAPHS_FOR_QA) return { count: 0, sample: "" };
  const questionOpeners: string[] = [];
  for (const sentences of paragraphs) {
    const first = sentences[0];
    if (first != null && first !== "" && QUESTION_OPENER.test(first)) {
      questionOpeners.push(first.slice(0, 60));
    }
  }
  if (questionOpeners.length < QA_QUESTION_THRESHOLD) return { count: 0, sample: "" };
  return { count: questionOpeners.length, sample: questionOpeners[0] ?? "" };
}

// A salutation addresses a person before the substance starts: a greeting word,
// or a name followed by a comma ("Dana, this fires for the entire run"). Only
// the opening line of a comment can carry one, so the test anchors there.
// Further down the same shape is ordinary third-person prose.
const GREETING_OPENER = /^(?:hi|hey|hello|dear|greetings|good\s+(?:morning|afternoon|evening))\b/i;
const ADDRESS_OPENER = /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?),(?:\s|$)/;

// Words that legitimately open a sentence ahead of a comma. Adverbs (-ly) and
// gerunds (-ing) are covered by shape, so what remains is the closed set of
// connectives, agreement words, and review idioms. A name that takes one of
// those forms (Holly, Sterling) is invisible to the check, which is the price
// of never denying "Otherwise, this looks right".
const SENTENCE_OPENERS = new Set([
  "above",
  "after",
  "afterward",
  "again",
  "agreed",
  "ah",
  "ahead",
  "also",
  "although",
  "altogether",
  "always",
  "and",
  "anyhow",
  "anyway",
  "anywhere",
  "aside",
  "assuming",
  "because",
  "before",
  "below",
  "besides",
  "best",
  "better",
  "beyond",
  "both",
  "but",
  "caveat",
  "context",
  "correct",
  "ditto",
  "docs",
  "done",
  "downstream",
  "earlier",
  "eh",
  "either",
  "elsewhere",
  "everywhere",
  "exactly",
  "fair",
  "false",
  "fine",
  "first",
  "five",
  "four",
  "fwiw",
  "given",
  "good",
  "granted",
  "great",
  "hence",
  "here",
  "hmm",
  "however",
  "huh",
  "if",
  "imho",
  "imo",
  "indeed",
  "inside",
  "instead",
  "last",
  "later",
  "likewise",
  "major",
  "majors",
  "maybe",
  "meantime",
  "meanwhile",
  "minor",
  "minors",
  "moreover",
  "neither",
  "net",
  "never",
  "nevertheless",
  "next",
  "nit",
  "nits",
  "no",
  "nonetheless",
  "nope",
  "not",
  "note",
  "notes",
  "now",
  "nowhere",
  "offline",
  "often",
  "oh",
  "ok",
  "okay",
  "once",
  "one",
  "online",
  "optional",
  "or",
  "otherwise",
  "outside",
  "overall",
  "per",
  "perhaps",
  "plus",
  "question",
  "questions",
  "rather",
  "regardless",
  "right",
  "same",
  "scope",
  "second",
  "since",
  "so",
  "sometimes",
  "somewhere",
  "soon",
  "sorry",
  "still",
  "style",
  "suggestion",
  "sure",
  "tangent",
  "tbh",
  "tests",
  "then",
  "there",
  "third",
  "though",
  "three",
  "thus",
  "tldr",
  "today",
  "together",
  "tomorrow",
  "tonight",
  "true",
  "two",
  "types",
  "understood",
  "unless",
  "unrelated",
  "until",
  "upstream",
  "well",
  "when",
  "where",
  "whereas",
  "while",
  "worse",
  "wrong",
  "yep",
  "yes",
  "yesterday",
  "yet",
  "ymmv",
]);

function isNameShaped(word: string): boolean {
  const lower = word.toLowerCase();
  if (SENTENCE_OPENERS.has(lower)) return false;
  return !lower.endsWith("ly") && !lower.endsWith("ing");
}

// Headings are skipped so a body that opens "## Review" is judged on the line
// that follows. stripCode has already blanked leading fenced code.
function openingLine(text: string): string {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length > 0 && !trimmed.startsWith("#")) return trimmed;
  }
  return "";
}

function salutationHits(text: string): Hits {
  const line = openingLine(text);
  if (line === "") return { count: 0, sample: "" };
  if (GREETING_OPENER.test(line)) return { count: 1, sample: line.slice(0, 40) };
  const address = ADDRESS_OPENER.exec(line)?.[1];
  if (address == null || address === "") return { count: 0, sample: "" };
  const head = address.split(/\s+/)[0] ?? "";
  if (!isNameShaped(head)) return { count: 0, sample: "" };
  return { count: 1, sample: `${address},` };
}

export const PATTERNS: PatternDef[] = [
  {
    tier: "deny",
    layer: "grammar",
    category: "salutation",
    sideEffectOnly: true,
    structural: true,
    test: salutationHits,
    message: (matched) =>
      `"${matched}" opens the comment with a salutation. Nothing published addresses a person, by name or greeting: no vocative, no invented name for a username. Delete the address and open on the substance.`,
    positives: [
      "Dana, this fires for the entire run rather than the changed files.",
      "Hi Dana,\n\nThe retry loop swallows the error.",
    ],
    negatives: [
      "Otherwise, this looks right.",
      "Given the constraint, the second pass is redundant.",
      "Nit, but the constant belongs next to its only caller.",
      "The retry loop swallows the error Dana, who wrote it, described.",
    ],
    evidence:
      "Recurring corrective feedback on published comments: five vocative openers across MR, PR, and Linear drafts between 2026-05-01 and 2026-08-20. The prose rule alone did not stop the fifth.",
    retire:
      "Remove when vocative openers stop appearing in corrective-feedback moments. Rebuild the name-shape test instead of extending it if SENTENCE_OPENERS starts accumulating entries that are not discourse connectives, which would mean the shape is matching ordinary nouns.",
  },
  {
    tier: "deny",
    layer: "grammar",
    category: "spaced em dash",
    structural: true,
    test: / — /g,
    message: () =>
      "Spaced em dashes ( — ) are an AI writing tell. Split the clauses into two sentences. Do not substitute a semicolon or unspaced em dash: the run-on structure is the problem, not the mark.",
    positives: [
      "The cache warms slowly — then it saturates.",
      "The worker finishes — the queue clears.",
    ],
    negatives: ["This is—fine without spaces.", "The range spans 2024–2025."],
    evidence:
      "Corpus audit and direct model-output observation. Spaced em dashes appear at high lift in assistant deliverables and are absent from the 209-PR hand-written baseline.",
    retire:
      "Remove when fewer than 5 hits appear in the deliverable corpus across a 30-day window, or when the pattern stops appearing in corrective-feedback moments.",
  },
  {
    tier: "deny",
    layer: "vocabulary",
    category: "AI vocabulary",
    test: WORDLISTS.vocabulary,
    message: (matched) =>
      `"${matched}" is flagged as AI-typical vocabulary. Use a more natural word.`,
    positives: ["delve into the codebase", "a meticulous review process", "a robust solution"],
    negatives: ["the function processes input", "the server returns a result"],
    evidence:
      "Vocabulary entries are individually corpus-audited for lift and distinctiveness. Each entry in vocabulary.txt has passed the rule-health check (model/M > baseline/M, count >= 5 in the audit window).",
    retire:
      "Each entry is individually reviewed via the analyze skill's rule-health table. Remove an entry when it falls below the min-count threshold or is no longer distinctive versus the user baseline.",
  },
  {
    tier: "deny",
    layer: "grammar",
    category: "copula avoidance",
    test: /\b(?:serves|stands) as\b/gi,
    message: (matched) => `"${matched}" avoids a simple copula. Use "is" or "are" instead.`,
    positives: ["The module serves as the entry point.", "This stands as a reminder."],
    negatives: ["The restaurant serves food.", "She stands at the podium."],
    evidence:
      "Pre-dates the curation principle; no corpus evidence recorded. Retained because the pattern is consistently wrong in practice and not a false-positive risk.",
    retire:
      "Remove if corrective-feedback moments stop referencing copula avoidance or if the pattern begins flagging legitimate usage in corpus spot-checks.",
  },
  ...openerPatterns,
  {
    tier: "deny",
    layer: "vocabulary",
    category: "sycophantic acknowledgment",
    test: /\byou(?:'re|\s+are)\s+(?:absolutely\s+|completely\s+)?right\b/gi,
    sideEffectOnly: true,
    message: () =>
      '"You\'re right" is a sycophantic acknowledgment. Move directly to the correction.',
    positives: ["You're right about the bug.", "You are absolutely right, I missed that."],
    negatives: ["Turn right at the corner.", "The right answer is to simplify."],
    evidence:
      "Pre-dates the curation principle; no corpus evidence recorded. Retained because the pattern reliably signals sycophancy in side-effect context.",
    retire:
      "Remove when corrective-feedback moments no longer cite acknowledgment phrases, or when the pattern produces false positives on non-sycophantic usage.",
  },
  {
    tier: "deny",
    layer: "grammar",
    category: "permission-seeking",
    test: /\bwant\s+me\s+to\s+\w+/gi,
    sideEffectOnly: true,
    message: () => '"Want me to ..." reads as permission-seeking. Just do it, or describe options.',
    positives: ["Want me to fix that for you?", "Want me to run the tests?"],
    negatives: ["They want me there by noon.", "I want to understand the issue."],
    evidence:
      "Pre-dates the curation principle; no corpus evidence recorded. Retained because the construction reliably signals permission-seeking in side-effect context.",
    retire:
      "Remove when the pattern no longer appears in corrective-feedback moments or when real permission-seeking phrases shift to a different form.",
  },
  {
    tier: "deny",
    layer: "grammar",
    category: "hedging close",
    test: /\bwould\s+you\s+like\b/gi,
    sideEffectOnly: true,
    message: () => '"Would you like ..." is a hedging close. State the next step directly.',
    positives: ["Would you like me to retry?", "Would you like a summary?"],
    negatives: ["I would like to understand your goal.", "They would like a design review."],
    evidence:
      "Pre-dates the curation principle; no corpus evidence recorded. Retained as a reliable hedging-close signal in conversational output.",
    retire:
      "Remove when corrective-feedback moments no longer cite hedging-close language, or when usage analysis shows the pattern is not appearing in assistant output.",
  },
  {
    tier: "deny",
    layer: "vocabulary",
    category: "reaching for",
    test: /\breach(?:ing|es|ed)?\s+for\b/gi,
    message: (matched) =>
      `"${matched}" is an AI-flavored figurative construction. Prefer "use" or "prefer X over Y".`,
    positives: [
      "Open a sibling pane rather than reaching for Bash.",
      "Reach for the linter before the formatter.",
    ],
    negatives: ["She reached the summit by noon.", "The fix is within reach."],
    evidence:
      "Pre-dates the curation principle; no corpus evidence recorded. Retained because the figurative construction is distinctive to AI output.",
    retire:
      "Remove if corpus analysis shows the phrase appears at low lift or if corrective-feedback moments stop citing it.",
  },
  {
    tier: "context",
    layer: "cross-sentence",
    category: "connector density",
    test: connectorDensityHits,
    fileOnly: true,
    message: (matched) =>
      `Many sentences here fuse independent clauses with semicolons or dashes (e.g. "${matched}"). This is run-on structure. Split each into two sentences. Swapping one connector for another is not a fix.`,
    positives: [
      "The cache starts cold; the first request fills it. The retry logic backs off; later attempts succeed. The parser rejects malformed input; it returns an error. The server validates each field. The client sends a token. The job runs nightly.",
      "The worker processes jobs; the queue drains. The log rotates nightly; the archive grows. The cache warms slowly; requests accelerate. The metric updates; the alert resets. The cron fires; the task runs. The server restarts; the pool rebuilds.",
    ],
    negatives: [
      "The cache starts cold. The first request fills it. The retry logic backs off.",
      "The server validates each field. The client sends a token. The job runs nightly.",
    ],
    evidence:
      "Pre-dates the curation principle; no corpus evidence recorded. The 30%-density threshold was set empirically to avoid false positives on definition-list bullets. Validated against the committed test suite.",
    retire:
      "Remove or raise the threshold if corpus analysis shows the pattern fires heavily on user text (not distinctive) or if a powered labeling pass shows precision below the hook bar.",
  },
  {
    tier: "context",
    layer: "cross-sentence",
    category: "semicolon splice",
    test: (text) => semicolonSpliceHits(text, PROSE_SPLICE_MIN),
    fileOnly: true,
    message: (matched) =>
      `Semicolons join independent clauses here (e.g. "${matched}"). This is the em-dash run-on respelled. Split each into two sentences rather than swapping connectors.`,
    positives: [
      "The cache starts cold; the first request fills it. The retry logic backs off; later attempts succeed.",
      "The hook fires on every edit; the scan runs first. The reminder never blocks; it only nudges.",
    ],
    negatives: [
      "The cache starts cold; the first request fills it. The retry logic backs off.",
      "- compile the sources; link the objects\n- package the build; ship the artifact",
      "The count was 2; see below. The limit was 3; see above.",
    ],
    evidence:
      "2026-07 session-history analysis found semicolon clause-joins at high rate in assistant deliverables after the em dash ban. Substitution drift relocated the run-on habit instead of fixing sentence structure. Short texts (PR bodies, commit messages) sit below the connector-density gate (5+ sentences, 30% density), so a two-splice floor covers them. An occasional single semicolon never fires.",
    retire:
      "Remove when the deliverable corpus shows the splice rate at or below the hand-written baseline for a 30-day window, or when a labeling pass shows precision below the hook bar. The claude-code:session semicolons-per-1000-words query is the evidence stream.",
  },
  {
    tier: "context",
    layer: "cross-sentence",
    category: "test result reporting",
    test: testResultHits,
    message: (matched) =>
      `Do not report test results, counts, or CI status ("${matched}"). Describe what is covered instead.`,
    positives: ["All 8 tests pass. Now let me check the linter.", "3/3 passing on Sonnet 4.6."],
    negatives: [
      "The tests fail because processInput is now async.",
      "Write a test for this function.",
    ],
    evidence:
      "Pattern emerged from corrective-feedback moments: users repeatedly asked the model to stop reporting pass/fail counts. Regex is validated against the committed shouldFlag/shouldNotFlag corpus in tropes.test.ts.",
    retire:
      "Remove when corrective-feedback moments stop citing result-reporting language, or when the model stops producing this pattern in assistant deliverables.",
  },
  {
    tier: "context",
    layer: "vocabulary",
    category: "promotional language",
    test: /\b(boasts|vibrant|showcasing|nestled|groundbreaking|renowned|diverse array)\b/gi,
    message: (matched) =>
      `"${matched}" reads as promotional AI language. Consider a more neutral word.`,
    positives: [
      "The library boasts excellent performance.",
      "A groundbreaking approach to caching.",
    ],
    negatives: ["The server handles concurrent requests.", "A well-tested approach to retries."],
    evidence:
      "Pre-dates the curation principle; no corpus evidence recorded. Each word in this list was identified as promotional AI vocabulary, but none has a per-entry corpus audit. Candidates for migration to vocabulary.txt once audited.",
    retire:
      "Migrate each entry to vocabulary.txt after a corpus audit confirms lift. Remove entries that fail the audit (not distinctive or dead).",
  },
  {
    tier: "context",
    layer: "vocabulary",
    category: "no X needed brag",
    test: noXNeededHits,
    message: (matched) =>
      `"${matched}" advertises what the design avoids. Describe what it does instead.`,
    positives: [
      "Handlers are auto-discovered, no config needed.",
      "It runs inline (no wrapper needed).",
      "Spin it up with no docker needed.",
    ],
    negatives: [
      "Reviewed the helper, no change needed.",
      "No further action needed here.",
      "There is no way the runtime needed that much memory.",
    ],
    evidence:
      'User flagged this trope directly; the working branch was named for it. The brag advertises an absent artifact ("no config/wrapper/docker needed") and its noun space is open-ended, so the detector flags the construction and carves out legitimate status reports instead. The assistant corpus shows why: status reports concentrate in a small set (change, action, fix, deverbal -tion/-sion/-ment nouns, re- dev verbs) while brags scatter across an unbounded artifact vocabulary. An allowlist of brag nouns goes stale; a status carve-out fails toward a visible, prunable over-nudge. A clean distinctiveness audit against the hand-written PR baseline is outstanding: user-role session text is contaminated because it contains pasted assistant output.',
    retire:
      "Add a word to the status carve-out (NO_X_ACTION_WORDS) when writing:scan shows it producing a false-positive nudge. Remove the pattern when the construction stops appearing in assistant deliverables or in corrective-feedback moments.",
  },
  {
    tier: "context",
    layer: "vocabulary",
    category: "flowery phrasing",
    test: (text) => stemmedPhraseHits(text, WORDLISTS.floweryPhrases),
    fileOnly: true,
    message: (matched) =>
      `"${matched}" is stock phrasing the model reaches for. State the mechanism plainly.`,
    positives: ["This keeps a single source of truth.", "Added an escape hatch for power users."],
    negatives: ["The truth about the data source is unclear.", "A hatch you can escape through."],
    evidence:
      "flowery-phrases.txt entries are audited per the deliverable-surface rule-health check. Each phrase has been validated against the model's deliverable corpus and the user's voice baseline.",
    retire:
      "Entries are individually reviewed via the analyze skill. Remove an entry when it is dead on the deliverable surface or not distinctive versus the voice baseline.",
  },
  {
    tier: "context",
    layer: "grammar",
    category: "parallelism",
    test: /\bnot (?:just|only) .{1,50}, but (?:also )?/gi,
    message: () =>
      '"Not just X, but also Y" is a common AI parallelism pattern. Simplify the sentence.',
    positives: [
      "It is not just fast, but also reliable.",
      "This not only improves speed, but reduces memory.",
    ],
    negatives: ["Not just yet.", "It is fast, reliable, and cheap."],
    evidence:
      "Pre-dates the curation principle; no corpus evidence recorded. Retained because the parallelism structure is a consistent AI tell that a regex captures reliably.",
    retire:
      "Remove if corpus analysis shows the pattern fires at low lift or if a grammar-layer replacement (tagger rule) is promoted and has equal or higher precision.",
  },
  {
    tier: "context",
    layer: "grammar",
    category: "contrast not",
    test: /\b\w[\w\s]{2,40},\s+not\s+\w[\w\s]{2,30}(?=[.!?,\n]|$)/gi,
    message: (matched) =>
      `"${matched}" is a rhetorical "X, not Y" contrast. State the positive directly.`,
    positives: ["This is a tool, not a framework.", "The goal is clarity, not perfection."],
    negatives: ["It is not the case that X.", "Not a framework, but a tool."],
    evidence:
      "Pre-dates the curation principle; no corpus evidence recorded. Retained because the rhetorical contrast form is a consistent AI-prose tell.",
    retire:
      "Remove if precision is low on a labeled corpus sample, or if the pattern fires heavily on user text (not distinctive).",
  },
  {
    tier: "context",
    layer: "grammar",
    category: "passive PR summary",
    test: /\b(?:is|was|are|were)\s+(?:added|updated|removed|refactored|introduced|created|deleted|modified|improved)\b/gi,
    fileOnly: true,
    message: (matched) =>
      `"${matched}" is passive voice in PR-style writing. Rewrite so something is doing the verb.`,
    positives: [
      "Retry logic is added to the HTTP client.",
      "The cache layer was refactored for clarity.",
    ],
    negatives: ["The server handles retries.", "We refactored the cache layer."],
    evidence:
      "Pre-dates the curation principle; no corpus evidence recorded. Retained as a passive-voice grammar rule for PR-style prose; a tagger-based replacement is a candidate per linguistics.md.",
    retire:
      "Replace with a tagger-based passive-voice rule once one is promoted per the hook bar in linguistics.md. Until then, keep the regex.",
  },
  {
    tier: "context",
    layer: "vocabulary",
    category: "tests cover preamble",
    test: /^Tests\s+(?:cover|verify|ensure|validate)\b/m,
    message: () =>
      '"Tests cover ..." elides the subject. Use "Added tests covering ..." or describe the change.',
    positives: ["Tests cover error handling for malformed JSON.", "Tests verify the retry logic."],
    negatives: ["Added tests covering error handling.", "The suite validates the retry logic."],
    evidence:
      "Pre-dates the curation principle; no corpus evidence recorded. Retained as a low-false-positive opener pattern.",
    retire:
      "Remove if the pattern stops appearing in deliverable prose or if corrective-feedback moments stop citing it.",
  },
  {
    tier: "context",
    layer: "grammar",
    category: "path bullet",
    test: /^\s*-\s*\*\*[^*\n]+\*\*\s*:\s*/m,
    fileOnly: true,
    message: () =>
      "`- **path**: description` bullets read as file manifests. Describe the conceptual change in prose.",
    positives: ["- **src/foo.ts**: refactors the helper", "- **index.ts**: adds the middleware"],
    negatives: ["- Added retry logic to the HTTP client", "- Refactored the cache layer"],
    evidence:
      "Pre-dates the curation principle; no corpus evidence recorded. The bullet form is a reliable proxy for AI-generated file-manifest PR bodies.",
    retire:
      "Remove when PR body style shifts away from file-manifest bullets in the deliverable corpus, or when the pattern fires on user-authored bullets at a high rate.",
  },
  {
    tier: "context",
    layer: "vocabulary",
    category: "trailing hedge",
    test: /\b(?:regardless|nonetheless|anyway)\.\s*(?:$|\n)/gim,
    fileOnly: true,
    message: (matched) =>
      `"${matched.trim()}" dangles at sentence end as AI hedging. Drop it or rewrite the clause.`,
    positives: [
      "The approach has tradeoffs regardless.\nNext sentence.",
      "The fix works anyway.\n",
    ],
    negatives: [
      "Regardless of the input, the parser rejects it.",
      "The fix works anyway you look at it.",
    ],
    evidence:
      "Pre-dates the curation principle; no corpus evidence recorded. Retained because trailing hedge words at sentence boundaries are a consistent AI-prose tell.",
    retire:
      "Remove if corpus analysis shows the pattern fires on user text at comparable rates (not distinctive).",
  },
  {
    tier: "context",
    layer: "grammar",
    category: "label bold",
    test: /^\s*\*\*[A-Z][A-Za-z ]+(?::\*\*|\*\*:)\s/m,
    fileOnly: true,
    message: () => "`**Label:**` reads as templated. Use a `####` header instead.",
    positives: ["**Why:** the diff is small", "**Note:** this is optional"],
    negatives: ["#### Why", "The diff is small."],
    evidence:
      "Pre-dates the curation principle; no corpus evidence recorded. Retained because the `**Label:**` form is a reliable AI-template signal in file writes.",
    retire:
      "Remove when the model reliably uses `####` headers instead, or when the pattern fires on user-authored markdown at a high rate.",
  },
  {
    tier: "context",
    layer: "vocabulary",
    category: "dig into",
    test: /\b(?:dig|digs|digging|dug|dive|dives|diving|dove|dived|wade|wades|wading|waded)\s+into\b/gi,
    message: (matched) =>
      `"${matched}" is exploration filler. Describe what you're actually looking at.`,
    positives: [
      "Let's dig into the codebase.",
      "I dug into the parser internals.",
      "She dove into the schema migration.",
      "We're digging into the root cause.",
    ],
    negatives: ["She dug a trench.", "Water drains into the basin."],
    evidence:
      "Corpus audit of assistant output found exploration-filler 'into' constructions in inflected forms the base-form regex missed, including the irregular past tenses 'dug into' and 'dove into'. Porter stemming cannot unify irregular verbs ('dug' stems to 'dug', not 'dig'), so each inflection is enumerated explicitly.",
    retire:
      "Remove if corpus analysis shows the construction is no longer distinctive. Drop individual inflections that stop appearing in assistant output.",
  },
  {
    tier: "context",
    layer: "vocabulary",
    category: "rides on",
    test: /\brid(?:e|es|ing)\s+(?:on|atop|alongside)\b/gi,
    skillOnly: true,
    message: (matched) =>
      `"${matched}" is figurative dependency language. State the relationship plainly: "X depends on Y", "X reuses Y", or "X piggybacks on Y".`,
    positives: [
      "The teardown rides on the normal end of a team.",
      "The new reader rides atop the existing httpfs layer.",
      "The sync loop rides alongside the existing poll cycle.",
    ],
    negatives: ["The cyclists ride for charity.", "She takes the early train to work."],
    evidence:
      "User-flagged 2026-06 as a recurring figurative construction for dependency or coupling ('X rides on Y'). It appears mostly in conversational reasoning, which neither the hook nor the additions miner reads, so it ships skillOnly pending a chat-voice calibration decision.",
    retire:
      "Remove if a chat-voice corpus pass shows the construction is not distinctive versus the user baseline. Promote to hook (drop skillOnly) only after a deliverable-corpus pass clears it at the hook precision bar.",
  },
  {
    tier: "context",
    layer: "vocabulary",
    category: "can bite",
    test: /\b(?:can|could|will|may|might)\s+bite\b/gi,
    skillOnly: true,
    message: (matched) =>
      `"${matched}" is figurative risk language for a latent bug. Name the failure: what breaks, and under what condition.`,
    positives: [
      "A stale cache entry can bite at runtime.",
      "That assumption could bite once the schema changes.",
    ],
    negatives: ["The dog will bark at strangers.", "This could break under load."],
    evidence:
      "User-flagged 2026-06 as a recurring figurative construction for latent-bug risk ('this can bite later'). It lives almost entirely in conversational reasoning, so it ships skillOnly pending a chat-voice calibration decision.",
    retire:
      "Remove if a chat-voice corpus pass shows the construction is not distinctive versus the user baseline. Promote to hook only after a deliverable-corpus pass clears it at the hook precision bar.",
  },
  {
    tier: "context",
    layer: "vocabulary",
    category: "surface as verb",
    test: /\bsurfac(?:e|es|ed|ing)\s+(?:the|a|an|that|this|these|those|any|all|each|its|their|every)\b/gi,
    skillOnly: true,
    message: (matched) =>
      `"${matched}" uses "surface" as a verb meaning reveal or report. Say "show", "report", or "expose".`,
    positives: [
      "The hook should surface the conflict to the user.",
      "The report surfaces these gaps automatically.",
    ],
    negatives: ["The attack surface is large.", "Reduce the API surface area."],
    evidence:
      "User-flagged 2026-06 as the highest-frequency tell, but 'surface' is polysemous: it is a load-bearing domain noun in this plugin ('chat surface', 'deliverable surface') and a word the user writes legitimately ('surface area'). The determiner lookahead targets the verb-with-object sense and spares the noun sense. Ships skillOnly because the verb sense itself appears in the user's own writing, so distinctiveness is unverified.",
    retire:
      "Remove if a sense-aware corpus pass shows the verb usage is not distinctive versus the user baseline. Do not promote to hook or add 'surface' to vocabulary.txt: a stem match cannot separate the verb from the domain noun.",
  },
  {
    tier: "context",
    layer: "vocabulary",
    category: "load-bearing",
    test: /\bload[- ]bearing\b/gi,
    message: (matched) =>
      `"${matched}" asserts importance by metaphor. Name the dependency instead: say what breaks or changes without it.`,
    positives: [
      "That comment is load-bearing for the retry logic.",
      "The ordering here is load bearing.",
    ],
    negatives: [
      "Removing the check breaks the parser.",
      "The retry logic depends on this ordering.",
    ],
    evidence:
      "User-flagged 2026-08 as the flagship gen-5 tell. Corpus audit (gen-5 era, 10.3M assistant chars): 287 hits at 27.8/M versus 3.4/M in typed user text, and several of the user hits are complaints about the word itself. A verify pass judged 43% of sampled uses bare gravity markers with no named load path; even the precise uses read better as a stated dependency.",
    retire:
      "Remove when the gen-5+ assistant rate falls under 5/M in a corpus audit window, or when a labeling pass shows most surviving uses name the dependency in-sentence.",
  },
  {
    tier: "context",
    layer: "vocabulary",
    category: "honest qualifier",
    test: /\bhonest\s+(?:(?:caveat|answer|statement|framing|read|assessment|version|number|timeline|headline|option|alternative|take)s?|summar(?:y|ies))\b/gi,
    message: (matched) =>
      `"${matched}" claims candor instead of showing it. Drop "honest" and state the fact; if a competing version is wrong, say what it gets wrong.`,
    positives: [
      "The honest answer is the cache never worked.",
      "One honest caveat: the benchmark only ran once.",
    ],
    negatives: ["The prefix keeps the test honest.", "Be honest about the coverage limits."],
    evidence:
      "Gen-5 corpus audit 2026-08: bare 'honest' runs 16.8/M assistant versus 3.7/M user, and 59 of 174 hits are the self-crediting noun frame (honest caveat/answer/statement/framing). Every sampled instance of the frame survived deletion of the adjective with no loss. The frame regex targets that shape and structurally spares the precise idioms ('keeps X honest', 'be honest about') and the instructed manner adverb ('report that honestly').",
    retire:
      "Remove when the noun-frame rate falls under 2/M in a corpus audit window. Extend the noun list only from corpus hits, never speculatively.",
  },
  {
    tier: "context",
    layer: "vocabulary",
    category: "attention-flag worth",
    test: /\bworth\s+(?:noting|knowing|flagging|mentioning|saying|stating|naming|recording|remembering|a\s+look|your\s+(?:attention|awareness|time|call))\b/gi,
    message: (matched) =>
      `"${matched}" announces that a point matters instead of making it. Cut the wrapper and state the point.`,
    positives: [
      "Two things worth flagging before this merges.",
      "Also worth noting for the rollout: the flag defaults off.",
      "One caveat worth your attention.",
    ],
    negatives: [
      "The refactor is worth doing before the freeze.",
      "That tradeoff is not worth it.",
      "The fix is worth confirming against staging.",
    ],
    evidence:
      "Gen-5 corpus audit 2026-08: the attention-flag frame (worth noting/knowing/flagging/your attention) runs 52.6/M assistant versus 2.9/M typed user (16.6x) across 166 sessions, and a verify pass found the wrapper deletable in every sampled case. The frame regex targets the flag lead-in and leaves cost-benefit judgments (worth doing/fixing/checking/it) unmatched. Subsumes the retired 'it's worth noting that' filler alternative.",
    retire:
      "Remove when the frame rate falls to the typed-user baseline in a corpus audit window, or when a labeling pass shows the frame mostly preceding genuinely optional asides.",
  },
  {
    tier: "context",
    layer: "vocabulary",
    category: "full picture",
    test: /\b(?:(?:full|complete|whole|real|bigger|clearer?)\s+picture|(?:chang(?:es?|ed|ing)|shift(?:s|ed|ing)?|complet(?:es?|ed|ing))\s+the\s+picture)\b/gi,
    skillOnly: true,
    message: (matched) =>
      `"${matched}" is a transition marker that defers the substance. Say what you learned or what changed.`,
    positives: [
      "After the third log read I have a complete picture.",
      "That stack trace changed the picture.",
    ],
    negatives: ["The picture shows the login screen.", "A reviewer would picture the whole flow."],
    evidence:
      "Gen-5 corpus audit 2026-08: 96 of 159 'picture' hits sit in two fixed frames (full/complete/whole picture, changes the picture), running 15.4/M assistant versus 3.7/M user, almost always as preamble before the actual finding. Zero hits in the deliverable sample, so it ships skillOnly: the hook never sees the chat surface where it lives.",
    retire:
      "Remove if a later corpus pass shows the frame rate collapsed, or fold into a chat-voice rewrite pass if one ships. Do not promote to hook while deliverable hits stay near zero.",
  },
  {
    tier: "context",
    layer: "vocabulary",
    category: "abstract story",
    test: /\b(?:rollback|cleanup|migration|error|consumer|state|budget|ingest|deletion|upgrade|onboarding|testing|deploy(?:ment)?|win)\s+stor(?:y|ies)\b/gi,
    skillOnly: true,
    message: (matched) =>
      `"${matched}" dresses up a plain referent. Name the thing: the rollback plan, the cleanup path, the error handling.`,
    positives: [
      "The migration story gets messy across major versions.",
      "This improves the rollback story.",
    ],
    negatives: [
      "The Storybook story renders the grid.",
      "The user story covers the checkout flow.",
    ],
    evidence:
      "Gen-5 corpus audit 2026-08: raw 'story' hits (415) are dominated by Storybook and agile user-story senses, so the noun list enumerates the abstraction frame's observed heads (rollback/cleanup/budget/ingest/consumer/state story, ~30 hits, chat-dominant). Ships skillOnly: low volume and no deliverable presence.",
    retire:
      "Drop head nouns that stop appearing in corpus audits. Remove the pattern when the frame stops recurring in chat output, or if the enumerated list needs constant extension to keep up (allowlist churn signals the wrong detector shape).",
  },
  {
    tier: "context",
    layer: "grammar",
    category: "hedging observation",
    test: /\b(?:looks|appears|seems)\s+(?:like|to)\b/gi,
    message: (matched) =>
      `"${matched}" is hedging observation. State the observation directly or name the uncertainty.`,
    positives: ["This looks like a regression.", "The fix appears to hold."],
    negatives: ["The output looks correct.", "She looks tired today."],
    evidence:
      "Pre-dates the curation principle; no corpus evidence recorded. Retained because hedging observation phrases are a consistent tell in assistant reasoning output.",
    retire:
      "Remove if corpus analysis shows low lift or if the pattern fires frequently on user text (not distinctive).",
  },
  {
    tier: "context",
    layer: "vocabulary",
    category: "filler",
    test: /\b(?:importantly|interestingly|it should be noted|as mentioned|in terms of)\b/gi,
    message: (matched) => `"${matched}" is filler. Cut it.`,
    positives: ["Interestingly, the cache is cold.", "Importantly, the test was skipped."],
    negatives: ["The cache is cold.", "Note that the test was skipped."],
    evidence:
      "Pre-dates the curation principle; no corpus evidence recorded. Retained as a vocabulary-level filler gate covering common AI preamble phrases. The 'it's worth noting that' alternative moved to the attention-flag worth pattern, whose frame regex covers it with corpus evidence.",
    retire:
      "Remove or migrate individual entries to vocabulary.txt after per-entry corpus audit confirms distinctiveness.",
  },
  {
    tier: "context",
    layer: "vocabulary",
    category: "I understand",
    test: /\bi\s+understand\b/gi,
    sideEffectOnly: true,
    message: () => '"I understand" is a sycophantic preamble. Move to the substance.',
    positives: ["I understand the issue.", "I understand your concern."],
    negatives: ["Do you understand the issue?", "The system understands the input."],
    evidence:
      "Pre-dates the curation principle; no corpus evidence recorded. Retained as a sideEffectOnly sycophantic-preamble marker.",
    retire:
      "Remove when corrective-feedback moments stop citing sycophantic preambles, or if the pattern stops appearing in assistant side-effect outputs.",
  },
  {
    tier: "context",
    layer: "grammar",
    category: "backtick path bullet",
    test: /^\s*-\s*`[^`\n]+`\s*:\s*/m,
    fileOnly: true,
    skillOnly: true,
    message: () =>
      "`` - `path`: description `` bullets read as file manifests. Describe the conceptual change in prose.",
    positives: ["- `src/foo.ts`: refactors the helper", "- `index.ts`: adds the middleware"],
    negatives: ["- Added retry logic to the HTTP client", "- **src/foo.ts**: refactors the helper"],
    evidence:
      "2026-06 corpus comparison: backtick path-bullet form appears in ~30% of AI-era bullets vs ~4% of the hand-written baseline. Hook promotion requires cross-project validation before shipping at hook frequency.",
    retire:
      "Promote to hook (remove skillOnly) after a cross-project labeling pass confirms precision at the hook bar. Retire when the pattern drops below baseline rate in the deliverable corpus.",
  },
  {
    tier: "context",
    layer: "cross-sentence",
    category: "template on small document",
    test: (text: string): Hits => {
      const wordCount = text.split(/\s+/).filter(Boolean).length;
      if (wordCount >= 150) return { count: 0, sample: "" };
      const hasChanges = /^##\s+Changes\b/m.test(text);
      const hasTesting = /^##\s+Testing\b/m.test(text);
      if (hasChanges && hasTesting) {
        return { count: 1, sample: "## Changes / ## Testing on small document" };
      }
      return { count: 0, sample: "" };
    },
    fileOnly: true,
    skillOnly: true,
    message: () =>
      "pull-request:create scopes ## Changes and ## Testing sections to larger changes. Length tracks substance. A short body with the full section template is over-structured. Use prose instead.",
    positives: [
      "## Changes\n\n- Adds retry logic\n\n## Testing\n\nRan the suite.\n\nFixes #1",
      "## Summary\n\nAdds a flag.\n\n## Changes\n\n- Adds `--verbose`\n\n## Testing\n\nManual.",
    ],
    negatives: [
      `Adds a cache layer. ${Array(20).fill("The cache reduces round-trips to the database by storing frequently accessed records in memory with a configurable TTL.").join(" ")}\n\n## Changes\n\n- Adds the LRU cache\n\n## Testing\n\nAdded tests for cache expiry and eviction.`,
      "## Changes\n\nAdds retry logic to the HTTP client.",
      "Fixes the race condition in the cache layer by adding a mutex.",
    ],
    evidence:
      "pull-request:create (SKILL.md) states: 'Use ## sections for larger changes. Length tracks substance.' A full section template on a body under ~150 words violates the skill's own rule. Threshold from corpus review of 209 hand-written PRs.",
    retire:
      "Remove or widen the word-count threshold if the corpus shows most short PRs include sections naturally, or if pull-request:create updates its conditionality guidance.",
  },
  {
    tier: "context",
    layer: "cross-sentence",
    category: "adversative negation-flip",
    fileOnly: true,
    test: adversativeNegationFlipHits,
    message: (matched) =>
      `Cross-sentence negation-flip: "${matched}". Negating then immediately conceding with "However/But/Yet" is an AI prose pattern. Merge into a single sentence or drop the negation.`,
    positives: [
      "The cache does not warm instantly. However, the first request fills it.",
      "This isn't a regression. But it does change observed behavior.",
    ],
    negatives: [
      "The cache fills on first request. However, it can evict under pressure.",
      "The server starts. The queue drains.",
      "The notable design held up under load. However, the rollout was slow.",
    ],
    evidence:
      "The CROSS_SENTENCE_NOT regex (8 hits in 2 sessions over 30 days) confirmed the contrast family fires rarely, so it was retired. This detector replaces it with a different shape: any negation cue followed by an adversative opener. Session-corpus calibration pending before hook promotion.",
    retire:
      "Remove when corpus analysis shows the pattern fires at comparable rates on user text (not distinctive), or when session-corpus calibration shows precision below the hook bar.",
  },
  {
    tier: "context",
    layer: "cross-sentence",
    category: "consequence chain",
    test: /,\s*so\s+(?:the|it|they|this|that|a)\b/gi,
    fileOnly: true,
    skillOnly: true,
    message: (matched) =>
      `"${matched}" chains clauses with ", so". Split into two sentences. State the cause and effect separately.`,
    positives: [
      "The cache fills up, so the old entries get evicted.",
      "The worker finishes, so the queue clears.",
    ],
    negatives: ["So the next step is to fix the test.", "This happens because the cache is full."],
    evidence:
      "2026-06 corpus comparison: consequence-chain rate ~3/1k words in AI-era deliverables. Per-document rate detector. Hook promotion requires cross-project validation.",
    retire:
      "Promote to hook after a cross-project labeling pass at the hook bar. Retire when the consequence-chain rate in deliverables falls below 1/1k words or matches the hand-written baseline.",
  },
  {
    tier: "context",
    layer: "cross-sentence",
    category: "question-answer cadence",
    fileOnly: true,
    test: questionAnswerCadenceHits,
    message: (matched) =>
      `Repeated question-opener paragraphs (e.g., "${matched}"). Using questions as section headers is an AI structuring pattern. State the point directly.`,
    positives: [
      "What does this do?\nIt processes jobs.\n\nWhy does it matter?\nPerformance improves.\n\nHow do you use it?\nCall the function.\n\nWhen should you avoid it?\nOn empty queues.",
      "What changed?\nThe retry logic.\n\nWhy now?\nFlakiness spiked.\n\nHow was it tested?\nUnit tests added.\n\nWhat is next?\nMonitor the error rate.",
    ],
    negatives: [
      // Fewer than 4 paragraphs
      "What does this do?\nIt processes jobs.\n\nWhy does it matter?\nPerformance improves.",
      // Only 1 question opener out of 4+ paragraphs
      "What does this do?\nIt processes jobs.\n\nThe retry logic changed.\n\nUnit tests were added.\n\nThe error rate dropped.",
    ],
    evidence:
      "Literature heuristic. Session-corpus calibration pending. Question-opener cadence is a known AI structuring pattern in explanatory prose. Threshold: 2 of 4+ paragraphs. Batch-only.",
    retire:
      "Remove when session-corpus calibration shows the pattern does not distinguish assistant from user text, or when precision on a labeled sample is below the hook bar.",
  },
];

const MARKETING_VERB_THRESHOLD = 3.0;
const SOFT_PHRASING_THRESHOLD = 3.0;

export const WEIGHTED_PATTERNS: WeightedPatternGroup[] = [
  {
    tier: "context",
    layer: "vocabulary",
    category: "marketing verbs",
    entries: WORDLISTS.marketingVerbs,
    threshold: MARKETING_VERB_THRESHOLD,
    message: (examples) =>
      `Marketing verbs stack up (${examples.join(", ")}). Describe concretely what changed instead of promotional framing.`,
    evidence:
      "marketing-verbs.txt entries are individually weighted and audited. The threshold (3.0) was set to require multiple co-occurring verbs, reducing false positives from a single occurrence.",
    retire:
      "Remove individual entries when the rule-health table shows them dead or not distinctive. Lower the threshold if the pattern stops firing in practice.",
  },
  {
    tier: "context",
    layer: "vocabulary",
    category: "soft phrasing",
    entries: WORDLISTS.softPhrasing,
    threshold: SOFT_PHRASING_THRESHOLD,
    fileOnly: true,
    message: (examples) =>
      `Soft phrasing piles up (${examples.join(", ")}). These read as filler. Describe what the code does plainly.`,
    evidence:
      "soft-phrasing.txt entries are individually weighted and audited against the deliverable corpus and voice baseline. The deliverable-surface audit (flowery-phrases and soft-phrasing) confirmed distinctiveness versus the 209-PR hand-written baseline.",
    retire:
      "Remove individual entries when the deliverable-surface rule-health check shows them dead or not distinctive versus the voice baseline.",
  },
];

function countNewlines(text: string): number {
  let count = 0;
  for (const char of text) {
    if (char === "\n") count++;
  }
  return count;
}

export type RegexCatalogEntry = {
  category: string;
  layer: DetectorLayer;
  pattern: RegExp;
  fileOnly?: boolean;
  sideEffectOnly?: boolean;
  skillOnly?: boolean;
  retire: string;
};

function globalize(pattern: RegExp): RegExp {
  return new RegExp(
    pattern.source,
    pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
  );
}

// The regex-backed structural patterns, normalized to the global flag for
// counting. Wordlist-backed patterns (stemmed vocabulary, weighted verbs, and
// the compiled openers regex) and function-based tests are excluded: a single
// regex match cannot count those, and the corpus FTS pass covers the wordlists.
//
// skillOnly patterns are included here so the batch analyze surface can audit
// them. The hook never calls this catalog; it calls scan() directly, which
// already skips skillOnly patterns.
export function regexCatalog(): RegexCatalogEntry[] {
  return PATTERNS.filter(
    (def): def is PatternDef & { test: RegExp } =>
      def.test instanceof RegExp && def.test !== WORDLISTS.openers,
  ).map((def) => ({
    category: def.category,
    layer: def.layer,
    pattern: globalize(def.test),
    fileOnly: def.fileOnly ?? false,
    sideEffectOnly: def.sideEffectOnly ?? false,
    skillOnly: def.skillOnly ?? false,
    retire: def.retire,
  }));
}

// stripCode: remove code from prose before running pattern detectors.
//
// Contract: replaces fenced blocks and inline code with whitespace that
// preserves line and column offsets, so a match index in the stripped text
// maps back to the same position in the source. This is the only cleaning
// the hook applies; it does NOT strip URLs, table rows, headers, or identifiers.
// Use this for any detector that needs position-accurate source mapping.
//
// Compare cleanText (ngram.ts): a more aggressive pipeline that also removes
// URLs, table lines, headers, CLI flags, and code-shaped identifiers. That
// pipeline is for n-gram mining where position accuracy is irrelevant and noise
// suppression matters more. Never use cleanText in the hook or scan paths.
export function stripCode(text: string): string {
  return text
    .replace(FENCED_CODE_BLOCK, (block) => "\n".repeat(countNewlines(block)))
    .replace(INLINE_CODE, (code) => " ".repeat(code.length));
}

function patternHits(stripped: string, def: PatternDef): Hits {
  if (typeof def.test === "function") {
    return def.test(stripped);
  }
  def.test.lastIndex = 0;
  const all = stripped.match(def.test);
  return { count: all?.length ?? 0, sample: all?.[0] ?? "" };
}

export function scan(text: string, filePath?: string, context?: ScanContext): PatternMatch[] {
  return scanIntroduced(text, "", filePath, context);
}

export function scanIntroduced(
  newText: string,
  oldText: string,
  filePath?: string,
  context?: ScanContext,
): PatternMatch[] {
  const newStripped = stripCode(newText);
  const oldStripped = stripCode(oldText);
  const matches: PatternMatch[] = [];

  for (const def of PATTERNS) {
    if (def.skillOnly) continue;
    if (def.fileOnly && filePath != null && filePath !== "" && !isProseFile(filePath)) continue;
    if (def.sideEffectOnly && context === "file") continue;

    const newHits = patternHits(newStripped, def);
    if (newHits.count === 0) continue;
    const oldHits = patternHits(oldStripped, def);
    if (newHits.count <= oldHits.count) continue;

    matches.push({
      tier: def.tier,
      category: def.category,
      matched: newHits.sample,
      message: def.message(newHits.sample),
      structural: def.structural ?? false,
    });
  }

  for (const group of WEIGHTED_PATTERNS) {
    if (group.fileOnly && filePath != null && filePath !== "" && !isProseFile(filePath)) continue;

    const newWeighted = weightedStemHits(newStripped, group.entries);
    if (newWeighted.totalWeight < group.threshold) continue;
    const oldWeighted = weightedStemHits(oldStripped, group.entries);
    if (newWeighted.totalWeight <= oldWeighted.totalWeight) continue;

    matches.push({
      tier: group.tier,
      category: group.category,
      matched: newWeighted.samples[0] ?? "",
      message: group.message(newWeighted.samples, newWeighted.totalWeight),
      structural: false,
    });
  }

  return matches;
}

export function firstByTier(matches: PatternMatch[], tier: PatternTier): PatternMatch | undefined {
  return matches.find((m) => m.tier === tier);
}
