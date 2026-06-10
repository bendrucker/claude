import { isProseFile } from "./paths";
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

const CROSS_SENTENCE_NOT =
  /\b(it|this|that|he|she|they|we|you)\s+(?:is|are|was|were)(?:n't|\s+not)\s+[^.!?]{1,80}[.!?]\s+\1\s+(?:is|are|was|were)\b/gi;

const CLAUSE_CONNECTOR = /;|—|[A-Za-z] [-–] [A-Za-z]/;
const HEADING = /^#{1,6}\s/;
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
  const sentences = text
    .split(/(?<!\d)[.!?]+(?=\s|$)|\n+/)
    .map((s) => s.trim())
    .filter((s) => !s.startsWith("|"))
    .filter((s) => !HEADING.test(s))
    .filter((s) => s.split(/\s+/).length >= 4);
  if (sentences.length < MIN_SENTENCES) return { count: 0, sample: "" };
  const connected = sentences.filter(isConnectorSentence);
  if (connected.length < MIN_CONNECTOR_SENTENCES) return { count: 0, sample: "" };
  if (connected.length / sentences.length < CONNECTOR_DENSITY) return { count: 0, sample: "" };
  const first = connected[0] as string;
  const i = CLAUSE_CONNECTOR.exec(first)?.index ?? 0;
  return { count: connected.length, sample: first.slice(Math.max(0, i - 20), i + 24).trim() };
}

export const PATTERNS: PatternDef[] = [
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
  {
    tier: "deny",
    layer: "vocabulary",
    category: "sycophantic opener",
    test: WORDLISTS.openers,
    sideEffectOnly: true,
    message: (matched) =>
      `"${matched.trim()}" reads as a sycophantic opener. Open with the substance.`,
    positives: ["Excellent! Moving on.", "Excellent. That settles it."],
    negatives: ["An excellent question to consider.", "It is great that the migration shipped."],
    evidence:
      "Openers list curated from corpus. Entries are plain-word matches at line start, reviewed for false-positive rate against normal prose.",
    retire:
      "Remove individual openers when they no longer appear in assistant side-effect outputs or when corrective-feedback moments stop citing them.",
  },
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
    category: "test result reporting",
    test: testResultHits,
    message: () =>
      "Do not report test results, counts, or CI status. Describe what is covered instead.",
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
    layer: "cross-sentence",
    category: "cross-sentence not-X",
    test: CROSS_SENTENCE_NOT,
    message: () =>
      'Cross-sentence "It isn\'t X. It is Y." patterns are an AI tell. Combine into one sentence or drop the negation.',
    positives: [
      "It isn't broken. It is slow.",
      "This isn't a regression. This is a design decision.",
    ],
    negatives: ["It isn't broken.", "The server is slow."],
    evidence:
      "Pre-dates the curation principle; no corpus evidence recorded. The cross-sentence structure is documented in linguistics.md (Trope Inventory) as a known AI tell with no tooling yet.",
    retire:
      "Remove if corpus analysis shows the pattern fires rarely or is not distinctive versus user text.",
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
    test: /\b(?:dig|dive|wade)\s+into\b/gi,
    message: (matched) =>
      `"${matched}" is exploration filler. Describe what you're actually looking at.`,
    positives: ["Let's dig into the codebase.", "We'll dive into the data later."],
    negatives: ["She dug a trench.", "The code dives into the network stack."],
    evidence:
      "Pre-dates the curation principle; no corpus evidence recorded. Retained as a vocabulary-level filler marker.",
    retire:
      "Remove if corpus analysis shows the phrase is no longer distinctive, or migrate to vocabulary.txt after a per-entry audit.",
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
    test: /\b(?:it's worth noting that|importantly|interestingly|it should be noted|as mentioned|in terms of)\b/gi,
    message: (matched) => `"${matched}" is filler. Cut it.`,
    positives: ["It's worth noting that the cache is cold.", "Importantly, the test was skipped."],
    negatives: ["The cache is cold.", "Note that the test was skipped."],
    evidence:
      "Pre-dates the curation principle; no corpus evidence recorded. Retained as a vocabulary-level filler gate covering common AI preamble phrases.",
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
    category: "consequence chain",
    test: /,\s*so\s+(?:the|it|they|this|that|a)\b/gi,
    fileOnly: true,
    skillOnly: true,
    message: (matched) =>
      `"${matched}" chains clauses with ", so". Split into two sentences; state the cause and effect separately.`,
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
    if (def.fileOnly && filePath && !isProseFile(filePath)) continue;
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
    if (group.fileOnly && filePath && !isProseFile(filePath)) continue;

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
