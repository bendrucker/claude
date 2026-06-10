// Voice-delta rate features: structural and lexical rates computed from a
// document or corpus that are compared against the pre-AI voice baseline.
//
// Each feature carries a provenance label sourced from the coordinator spec
// (issue #789). The label governs how drift is read:
//
//   skill-prescribed  — the skill mandates the pattern. Aggregate drift means
//                       tune the skill, not build a detector.
//   skill-encouraged  — the skill asks for the feature. A deficit is
//                       under-application of the skill.
//   ungoverned        — no skill governs it. Genuine voice signal; detector
//                       territory.
//
// Resolution principle: skill-prescribed features are NEVER reported as
// per-document flags. They are rates-only in every surface. Only ungoverned
// features may produce per-document flags.

export type Provenance = "skill-prescribed" | "skill-encouraged" | "ungoverned";

export interface VoiceDeltaFeature {
  id: string;
  label: string;
  provenance: Provenance;
  // Human-readable description of the provenance source. Matches the spec table.
  source: string;
  // Compute the feature rate from raw text. Rates are per-1000 words unless
  // isFraction is true. Returns 0 when no content is present.
  compute: (text: string) => number;
  // Format a rate value for display. Most features show 2 decimal places.
  format?: (rate: number) => string;
  // When true, the rate is a fraction (0–1) rather than per-1000 words.
  isFraction?: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Count raw words (whitespace-separated tokens, strip punctuation).
function wordCount(text: string): number {
  return (text.match(/\b[a-zA-Z'-]+\b/g) ?? []).length;
}

// Count sentences. Split on sentence-ending punctuation followed by whitespace
// or end of string; treat each non-empty segment as a sentence.
export function sentenceSplit(text: string): string[] {
  return text
    .split(/[.!?]+(?:\s+|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Count non-empty lines.
function nonEmptyLines(text: string): string[] {
  return text.split("\n").filter((l) => l.trim().length > 0);
}

// Remove fenced code blocks while preserving line structure. Line- and
// heading-based features use this so a `# comment` inside a shell snippet does
// not register as a markdown heading and code lines do not inflate line
// denominators. stripCode flattens whitespace, which would destroy line-based
// rates.
function stripFencedBlocks(text: string): string {
  return text.replace(/```[\s\S]*?```/g, "");
}

// Strip fenced and inline code blocks before rate counting.
function stripCode(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]+`/g, " ")
    .replace(/https?:\/\/\S+/g, " URL ");
}

// Count total words in stripped text. Avoids counting code tokens.
function strippedWordCount(text: string): number {
  return wordCount(stripCode(text));
}

// Count backtick characters in the original text (raw inline code fences).
function countBackticks(text: string): number {
  // Remove fenced blocks first to avoid double-counting their delimiters.
  const nofence = text.replace(/```[\s\S]*?```/g, "");
  return (nofence.match(/`/g) ?? []).length;
}

// Collect bullet lines: lines starting with `- ` or `* ` (possibly indented).
function bulletLines(text: string): string[] {
  return nonEmptyLines(text).filter((l) => /^\s*[-*]\s/.test(l));
}

// Count backtick-manifest bullets: `- \`identifier\`: description` pattern.
function countBacktickManifestBullets(text: string): number {
  return bulletLines(text).filter((l) => /^\s*[-*]\s+`[^`]+`\s*:/.test(l)).length;
}

// ─── Feature definitions ──────────────────────────────────────────────────────

function per1k(count: number, words: number): number {
  if (words === 0) return 0;
  return (count / words) * 1000;
}

export const VOICE_DELTA_FEATURES: VoiceDeltaFeature[] = [
  {
    id: "first_person_rate",
    label: "First-person voice (I/we per 1k)",
    provenance: "skill-encouraged",
    source:
      'SKILL.md Body: "use \'I\' so it\'s clear you made the call". sections.md Issue: "Describe the root cause as the author"',
    compute: (text) => {
      const stripped = stripCode(text);
      const words = strippedWordCount(stripped);
      // "I" must stay uppercase (lowercase "i" is usually a loop variable),
      // while "we" appears sentence-initial as "We".
      const matches = stripped.match(/\b(?:I|[Ww]e)\b/g) ?? [];
      return per1k(matches.length, words);
    },
  },
  {
    id: "causal_language_rate",
    label: "Causal language (since/because per 1k)",
    provenance: "skill-encouraged",
    source:
      'SKILL.md Voice: "State the mechanism first, then the motivation" and "Hedge and name rejected alternatives honestly"',
    compute: (text) => {
      const stripped = stripCode(text);
      const words = strippedWordCount(stripped);
      const matches = stripped.match(/\b(since|because)\b/gi) ?? [];
      return per1k(matches.length, words);
    },
  },
  {
    id: "body_length",
    label: "Body length (words)",
    provenance: "skill-encouraged",
    source:
      'SKILL.md Voice: "Length tracks substance. A one-line change gets a one-line body. Don\'t pad"',
    compute: (text) => strippedWordCount(text),
    format: (rate) => rate.toFixed(0),
  },
  {
    id: "url_rate",
    label: "URL cross-references (per 1k words)",
    provenance: "ungoverned",
    source: "References section exists but no rate guidance",
    compute: (text) => {
      const words = strippedWordCount(text);
      const urls = (text.match(/https?:\/\/\S+/g) ?? []).length;
      return per1k(urls, words);
    },
  },
  {
    id: "median_sentence_length",
    label: "Sentence length median (words)",
    provenance: "ungoverned",
    source: "no skill text",
    compute: (text) => {
      const stripped = stripCode(text);
      const sentences = sentenceSplit(stripped);
      if (sentences.length === 0) return 0;
      const lengths = sentences.map((s) => wordCount(s)).sort((a, b) => a - b);
      const mid = Math.floor(lengths.length / 2);
      return lengths.length % 2 === 0
        ? ((lengths[mid - 1] ?? 0) + (lengths[mid] ?? 0)) / 2
        : (lengths[mid] ?? 0);
    },
    format: (rate) => rate.toFixed(1),
  },
  {
    id: "p90_sentence_length",
    label: "Sentence length p90 (words)",
    provenance: "ungoverned",
    source: "no skill text",
    compute: (text) => {
      const stripped = stripCode(text);
      const sentences = sentenceSplit(stripped);
      if (sentences.length === 0) return 0;
      const lengths = sentences.map((s) => wordCount(s)).sort((a, b) => a - b);
      const idx = Math.floor(lengths.length * 0.9);
      return lengths[Math.min(idx, lengths.length - 1)] ?? 0;
    },
    format: (rate) => rate.toFixed(1),
  },
  {
    id: "question_mark_rate",
    label: "Question marks (per 1k words)",
    provenance: "ungoverned",
    source: "no skill text",
    compute: (text) => {
      const stripped = stripCode(text);
      const words = strippedWordCount(stripped);
      const qmarks = (stripped.match(/\?/g) ?? []).length;
      return per1k(qmarks, words);
    },
  },
  {
    id: "template_presence",
    label: "Template presence (## Changes + ## Testing)",
    provenance: "skill-prescribed",
    source:
      'SKILL.md Body: "Use `##` sections for larger changes". Aggregate template rate is an analyze trend only',
    // Returns 1 if both template sections are present, 0 otherwise.
    compute: (text) => {
      const prose = stripFencedBlocks(text);
      const hasChanges = /^##\s+(Changes|What Changed)\b/im.test(prose);
      const hasTesting = /^##\s+Testing\b/im.test(prose);
      return hasChanges && hasTesting ? 1 : 0;
    },
    isFraction: true,
    format: (rate) => `${(rate * 100).toFixed(0)}%`,
  },
  {
    id: "unique_heading_variety",
    label: "Unique heading texts (count)",
    provenance: "skill-prescribed",
    source:
      "sections.md fixes the section vocabulary (Issue/Changes/Testing/References). Aggregate uniformity metric only, never per-document",
    // Returns the count of unique heading texts (lowercased) in this document.
    compute: (text) => {
      const headings = [...stripFencedBlocks(text).matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) =>
        (m[1] ?? "").toLowerCase().trim(),
      );
      return new Set(headings).size;
    },
    format: (rate) => rate.toFixed(0),
  },
  {
    id: "heading_rate",
    label: "Has any heading (fraction of documents)",
    provenance: "skill-prescribed",
    source: 'Same "larger changes" clause as template presence. Report as a trend',
    // Returns 1 if the document contains any markdown heading, 0 otherwise.
    compute: (text) => (/^#{1,6}\s+/m.test(stripFencedBlocks(text)) ? 1 : 0),
    isFraction: true,
    format: (rate) => `${(rate * 100).toFixed(0)}%`,
  },
  {
    id: "action_verb_opener_rate",
    label: "Action-verb opener lines (fraction of lines)",
    provenance: "skill-prescribed",
    source:
      'SKILL.md Voice: "Open with a bare present-tense verb". Skill prescribes only the opening summary line; stacking across lines is the drift signal',
    compute: (text) => {
      const lines = nonEmptyLines(stripFencedBlocks(text));
      if (lines.length === 0) return 0;
      // Match lines (including bullets, where the pattern stacks) opening with
      // a common present-tense verb (capitalized).
      const verbOpener =
        /^\s*(?:[-*]\s+)?(?:Add|Remove|Extract|Fix|Update|Refactor|Move|Rename|Delete|Enable|Disable|Replace|Expose|Allow|Prevent|Extend|Create|Set|Run|Use|Make|Build|Change|Skip|Drop|Emit|Load|Save|Return|Push|Pull|Pass|Wrap|Bump|Pin|Guard|Gate|Handle|Limit|Filter|Sort|Map|Merge|Split|Read|Write|Mark|Track|Log|Check|Test|Wire|Inject|Import|Export|Bind|Align|Trim|Convert|Compute|Parse|Validate|Normalize)[a-z]*(?:\s|$)/;
      const openers = lines.filter((l) => verbOpener.test(l)).length;
      return openers / lines.length;
    },
    isFraction: true,
    format: (rate) => `${(rate * 100).toFixed(1)}%`,
  },
  {
    id: "backtick_density",
    label: "Backtick density (per 1k words)",
    provenance: "skill-prescribed",
    source:
      'SKILL.md Body: "Wrap all code identifiers with backticks". Density beyond ~60/1k is over-application',
    compute: (text) => {
      const words = strippedWordCount(text);
      const ticks = countBackticks(text);
      return per1k(ticks, words);
    },
  },
  {
    id: "backtick_manifest_bullet_rate",
    label: "Backtick-manifest bullets (fraction of bullets)",
    provenance: "ungoverned",
    source:
      'sections.md bans the bold form ("Never structure bullets as **path**: description"). The backtick variant evades the letter of the rule',
    compute: (text) => {
      const prose = stripFencedBlocks(text);
      const bullets = bulletLines(prose);
      if (bullets.length === 0) return 0;
      return countBacktickManifestBullets(prose) / bullets.length;
    },
    isFraction: true,
    format: (rate) => `${(rate * 100).toFixed(1)}%`,
  },
  {
    id: "consequence_chain_rate",
    label: "Consequence chains (, so <det>) per 1k words",
    provenance: "ungoverned",
    source: "no skill text. #788 detector",
    compute: (text) => {
      const stripped = stripCode(text);
      const words = strippedWordCount(stripped);
      // Pattern: ", so" followed by a determiner.
      const matches =
        stripped.match(/,\s+so\s+(?:the|a|an|this|that|these|those|its|their|our)\b/gi) ?? [];
      return per1k(matches.length, words);
    },
  },
];

// ─── Register check ───────────────────────────────────────────────────────────

// Minimum sentences to attempt baseline comparison. Too-short inputs produce
// meaningless rate stats.
const MIN_SENTENCES = 3;
// Maximum markdown character fraction for the document to be prose-like.
// Beyond this threshold the input is likely a code file, not a prose deliverable.
const MAX_MARKDOWN_FRACTION = 0.7;

export interface RegisterCheck {
  inRegister: boolean;
  reason: string | null;
}

// Returns whether the document is in-register (looks like a PR-body-shaped
// prose deliverable) and therefore safe to compare against the PR baseline.
export function checkRegister(text: string): RegisterCheck {
  const total = text.length;
  if (total === 0) return { inRegister: false, reason: "empty document" };

  const sentences = sentenceSplit(stripCode(text));
  if (sentences.length < MIN_SENTENCES) {
    return {
      inRegister: false,
      reason: `too short (${sentences.length} sentence(s); need ${MIN_SENTENCES}+)`,
    };
  }

  const mdChars = (text.match(/[#*_`[\]]/g) ?? []).length;
  const mdFraction = mdChars / total;
  if (mdFraction > MAX_MARKDOWN_FRACTION) {
    return {
      inRegister: false,
      reason: `high markdown fraction (${(mdFraction * 100).toFixed(0)}%; threshold ${(MAX_MARKDOWN_FRACTION * 100).toFixed(0)}%)`,
    };
  }

  return { inRegister: true, reason: null };
}

// ─── Corpus aggregation ───────────────────────────────────────────────────────

export interface FeatureRate {
  featureId: string;
  rate: number;
  documentCount: number;
}

// Compute per-feature mean rates across a corpus of document texts.
// The register check applies to single-document scoring only. Corpus
// aggregation runs over all documents regardless of individual length.
export function computeCorpusRates(texts: string[]): Map<string, FeatureRate> {
  const sums = new Map<string, number>();
  const counts = new Map<string, number>();

  for (const text of texts) {
    for (const feature of VOICE_DELTA_FEATURES) {
      const rate = feature.compute(text);
      sums.set(feature.id, (sums.get(feature.id) ?? 0) + rate);
      counts.set(feature.id, (counts.get(feature.id) ?? 0) + 1);
    }
  }

  const result = new Map<string, FeatureRate>();
  for (const feature of VOICE_DELTA_FEATURES) {
    const total = sums.get(feature.id) ?? 0;
    const n = counts.get(feature.id) ?? 0;
    result.set(feature.id, {
      featureId: feature.id,
      rate: n > 0 ? total / n : 0,
      documentCount: n,
    });
  }
  return result;
}

// ─── Baseline stats from profile ─────────────────────────────────────────────

// The additional aggregate stats that voice-profile.ts stores for voice-delta
// comparison. Computed during profile build from the baseline corpus.
// When a loaded profile predates this extension (voiceDelta missing), each
// feature degrades to a "no baseline" display.
export interface VoiceDeltaBaseline {
  // Feature id -> mean rate across the baseline corpus.
  rates: Record<string, number>;
  documentCount: number;
  computedAt: string;
}
