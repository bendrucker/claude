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

import type { Nodes, Paragraph, Parent } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { visit } from "unist-util-visit";
import { z } from "zod";
import { noNegationHits, notNegationHits } from "../../../detection/negation";

export type Provenance = "skill-prescribed" | "skill-encouraged" | "ungoverned";

export interface VoiceDeltaFeature {
  id: string;
  label: string;
  provenance: Provenance;
  // Human-readable description of the provenance source.
  source: string;
  // Compute the feature rate from raw text. Rates are per-1000 words unless
  // isFraction is true. Returns 0 when no content is present.
  compute: (text: string) => number;
  format?: (rate: number) => string;
  // When true, the rate is a fraction (0–1) rather than per-1000 words.
  isFraction?: boolean;
}

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

function nonEmptyLines(text: string): string[] {
  return text.split("\n").filter((l) => l.trim().length > 0);
}

// Remove fenced code blocks while preserving line structure. Line- and
// heading-based features use this so a `# comment` inside a shell snippet does
// not register as a markdown heading and code lines do not inflate line
// denominators. stripCode flattens whitespace, which would destroy line-based
// rates.
function stripFencedBlocks(text: string): string {
  return text.replaceAll(/```[\s\S]*?```/g, "");
}

// Strip fenced and inline code blocks before rate counting.
function stripCode(text: string): string {
  return text
    .replaceAll(/```[\s\S]*?```/g, " ")
    .replaceAll(/`[^`]+`/g, " ")
    .replaceAll(/https?:\/\/\S+/g, " URL ");
}

// Count total words in stripped text. Avoids counting code tokens. Exported so
// the rate-nulls length band measures a document the same way the rates that
// band gates normalize it.
export function strippedWordCount(text: string): number {
  return wordCount(stripCode(text));
}

function countBackticks(text: string): number {
  // Remove fenced blocks first to avoid double-counting their delimiters.
  const nofence = text.replaceAll(/```[\s\S]*?```/g, "");
  return (nofence.match(/`/g) ?? []).length;
}

function bulletLines(text: string): string[] {
  return nonEmptyLines(text).filter((l) => /^\s*[-*]\s/.test(l));
}

// Count backtick-manifest bullets: `- \`identifier\`: description` pattern.
function countBacktickManifestBullets(text: string): number {
  return bulletLines(text).filter((l) => /^\s*[-*]\s+`[^`]+`\s*:/.test(l)).length;
}

function per1k(count: number, words: number): number {
  if (words === 0) return 0;
  return (count / words) * 1000;
}

// Clause-linking vocabulary for the subordinate:coordinate ratio. Agent-era
// deliverables coordinate where the pre-AI baseline subordinates: the ratio
// runs 0.44x the baseline on length-matched PR bodies and 0.66x on review
// comments. Word-level counting stands in for a parse. "that" and "if" carry
// non-clausal senses, so read the ratio as a rate and not as a clause census.
const COORDINATORS = /\b(?:and|or|but)\b/gi;
const SUBORDINATORS =
  /\b(?:because|since|although|though|while|whereas|unless|until|when|where|which|who|whose|that|if)\b/gi;

// Negative-contrast constructions run ~2.8x the pre-AI baseline across both
// PR bodies and review comments. The writing skill already bans "X, not Y"
// contrast. This measures the wider family the wordlists do not reach.
const NEGATIVE_CONTRAST = /\b(?:rather than|instead of|not\s+\w+,?\s+but|never)\b/gi;

// Multi-word markers lead the alternation because JS picks the first matching
// branch at a position, and a shorter branch listed first would clip the longer
// phrase.
const DISCOURSE_MARKERS =
  /\b(?:on the other hand|in other words|at the same time|as a result|in addition|in contrast|in particular|in short|in fact|that said|for instance|for example|to that end|as such|however|moreover|furthermore|additionally|consequently|therefore|thus|hence|nevertheless|nonetheless|meanwhile|similarly|likewise|conversely|accordingly|subsequently|notably|importantly|ultimately|overall|indeed|arguably|crucially|specifically|essentially|fundamentally)\b/gi;

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
      const lengths = sentences.map((s) => wordCount(s)).toSorted((a, b) => a - b);
      const mid = Math.floor(lengths.length / 2);
      return lengths.length % 2 === 0
        ? ((lengths[mid - 1] ?? 0) + (lengths[mid] ?? 0)) / 2
        : (lengths[mid] ?? 0);
    },
    format: (rate) => rate.toFixed(1),
  },
  {
    id: "template_presence",
    label: "Template presence (## Changes + ## Testing)",
    provenance: "skill-prescribed",
    source:
      'SKILL.md Body: "Use `##` sections for larger changes". Aggregate template rate is an analyze trend only',
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
  {
    id: "subordinate_coordinate_ratio",
    label: "Subordinate:coordinate clause ratio",
    provenance: "ungoverned",
    source: "no skill text. Fightin' Words corpus comparison, 2026-08",
    compute: (text) => {
      const stripped = stripCode(text);
      const coordinators = stripped.match(COORDINATORS) ?? [];
      if (coordinators.length === 0) return 0;
      const subordinators = stripped.match(SUBORDINATORS) ?? [];
      return subordinators.length / coordinators.length;
    },
    format: (rate) => rate.toFixed(2),
  },
  {
    id: "no_negation_share",
    label: "No-negation share (no-form of all negated indefinites)",
    provenance: "skill-prescribed",
    source:
      'SKILL.md Word Choice: name the positive term first ("a no-op", "unchanged"), then verb negation when the negation is the point',
    compute: (text) => {
      const stripped = stripCode(text);
      const noForm = noNegationHits(stripped).count;
      const notForm = notNegationHits(stripped).count;
      if (noForm + notForm === 0) return 0;
      return noForm / (noForm + notForm);
    },
    format: (rate) => rate.toFixed(2),
    isFraction: true,
  },
  {
    id: "negation_rate",
    label: "Negation (no-form and not-form per 1k)",
    provenance: "skill-prescribed",
    source:
      'SKILL.md Word Choice: name the positive term first ("a no-op", "unchanged"), then verb negation when the negation is the point',
    compute: (text) => {
      const stripped = stripCode(text);
      const words = strippedWordCount(stripped);
      return per1k(noNegationHits(stripped).count + notNegationHits(stripped).count, words);
    },
  },
  {
    id: "negative_contrast_rate",
    label: "Negative contrast (rather than/instead of/never per 1k)",
    provenance: "ungoverned",
    source: "no skill text. Fightin' Words corpus comparison, 2026-08",
    compute: (text) => {
      const stripped = stripCode(text);
      const words = strippedWordCount(stripped);
      const matches = stripped.match(NEGATIVE_CONTRAST) ?? [];
      return per1k(matches.length, words);
    },
  },
  {
    id: "discourse_marker_rate",
    label: "Discourse markers (however/therefore/in addition per 1k)",
    provenance: "ungoverned",
    source:
      "no skill text and no wordlist covers the connective family. A deficit feature: agent prose runs well under the baseline",
    compute: (text) => {
      const stripped = stripCode(text);
      const words = strippedWordCount(stripped);
      const matches = stripped.match(DISCOURSE_MARKERS) ?? [];
      return per1k(matches.length, words);
    },
  },
];

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const average = mean(values);
  const variance =
    values.reduce((total, value) => total + (value - average) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

// Articles carry no parallelism signal, since "the parser returns" and "a
// router returns" open alike. tricolon.ts drops the same class from its shapes.
const PARALLEL_LEADING_ARTICLE = /^(?:the|a|an)\s+/i;
// Shorter units share an opening by chance, the reason tricolon.ts gates its
// triples at six tokens.
const PARALLEL_MIN_TOKENS = 3;

// Block structure comes from the parser. A line pattern misses ordered markers
// ("1. ") and reads every nesting depth as one level, and the corpus nests
// lists heavily.
function blockText(node: Nodes): string {
  let text = "";
  visit(node, (child) => {
    if (child.type === "text" || child.type === "inlineCode") text += child.value;
  });
  return text;
}

function rootParagraphs(text: string): Paragraph[] {
  return fromMarkdown(text).children.filter((node) => node.type === "paragraph");
}

// Every list item and every sentence of a free-standing paragraph, in document
// order, since the rate compares each unit against the one before it. A list
// item contributes its own paragraphs and leaves any list nested inside it to
// the items of that list.
function parallelUnits(text: string): string[] {
  const units: string[] = [];
  visit(fromMarkdown(text), (node: Nodes, _index, parent: Parent | undefined) => {
    if (node.type === "listItem") {
      const own = node.children
        .filter((child) => child.type === "paragraph")
        .map(blockText)
        .join(" ");
      if (own.length > 0) units.push(own);
      return;
    }
    if (node.type === "paragraph" && parent?.type !== "listItem") {
      units.push(...sentenceSplit(blockText(node)));
    }
  });
  return units;
}

function parallelOpener(unit: string): string | null {
  if (wordCount(unit) < PARALLEL_MIN_TOKENS) return null;
  const words =
    unit
      .trim()
      .replace(PARALLEL_LEADING_ARTICLE, "")
      .match(/\b[a-zA-Z'-]+\b/g) ?? [];
  return words[0]?.toLowerCase() ?? null;
}

// Candidates measured against the permutation null and left out of
// VOICE_DELTA_FEATURES. `rate-nulls.ts --candidates` scores them, so a
// retirement stays reproducible and can be revisited as the baseline grows.
// Nothing else reads this array: a retired candidate never reaches a profile,
// a report, or a per-document flag. references/methodology.md holds the
// measurements that put each one here.
export const RETIRED_FEATURES: VoiceDeltaFeature[] = [
  {
    id: "sentence_length_burstiness",
    label: "Sentence-length burstiness (−1 regular, +1 bursty)",
    provenance: "ungoverned",
    source: "no skill text. Retired: tracks document length, not voice",
    // Goh-Barabási burstiness, (σ − μ)/(σ + μ), bounded to [−1, 1]. Bounded
    // because corpus rates are an unweighted mean over documents, where one
    // short document's coefficient of variation would otherwise dominate.
    compute: (text) => {
      const sentences = sentenceSplit(stripCode(text));
      if (sentences.length < 2) return 0;
      const lengths = sentences.map((sentence) => wordCount(sentence));
      const average = mean(lengths);
      const deviation = standardDeviation(lengths);
      if (average + deviation === 0) return 0;
      return (deviation - average) / (deviation + average);
    },
    format: (rate) => rate.toFixed(3),
  },
  {
    id: "parallel_construction_rate",
    label: "Parallel openers (fraction of adjacent unit pairs)",
    provenance: "ungoverned",
    source: "no skill text. Retired: below its floor at every stratification",
    compute: (text) => {
      const openers = parallelUnits(text).map(parallelOpener);
      let pairs = 0;
      let parallel = 0;
      for (let index = 1; index < openers.length; index++) {
        const previous = openers[index - 1];
        const current = openers[index];
        if (previous == null || current == null) continue;
        pairs++;
        if (previous === current) parallel++;
      }
      return pairs === 0 ? 0 : parallel / pairs;
    },
    isFraction: true,
    format: (rate) => `${(rate * 100).toFixed(1)}%`,
  },
  {
    id: "paragraph_length_uniformity",
    label: "Paragraph-length uniformity (1 = every paragraph equal)",
    provenance: "ungoverned",
    source: "no skill text. Retired: tracks document length, not voice",
    compute: (text) => {
      // Prose paragraphs alone. Splitting on blank lines counts each heading as
      // a one-word paragraph, and headings are where the two corpora differ
      // most, so the variance measured that way tracks heading density.
      const lengths = rootParagraphs(text).map((node) => wordCount(blockText(node)));
      if (lengths.length < 2) return 0;
      const average = mean(lengths);
      if (average === 0) return 0;
      // Complement of the coefficient of variation, clamped so one outsized
      // paragraph reads as zero uniformity rather than negative.
      return 1 - Math.min(standardDeviation(lengths) / average, 1);
    },
    isFraction: true,
    format: (rate) => `${(rate * 100).toFixed(1)}%`,
  },
];

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

export interface FeatureRate {
  featureId: string;
  rate: number;
  documentCount: number;
}

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

// The additional aggregate stats that voice-profile.ts stores for voice-delta
// comparison. Computed during profile build from the baseline corpus.
// When a loaded profile predates this extension (voiceDelta missing), each
// feature degrades to a "no baseline" display.
export const VoiceDeltaBaseline = z.object({
  // Feature id -> mean rate across the baseline corpus.
  rates: z.record(z.string(), z.number()),
  documentCount: z.number(),
  computedAt: z.string(),
});
export type VoiceDeltaBaseline = z.infer<typeof VoiceDeltaBaseline>;
