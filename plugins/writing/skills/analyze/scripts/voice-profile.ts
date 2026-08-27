#!/usr/bin/env bun
import { mkdirSync } from "node:fs";
import { cli } from "cleye";
import { z } from "zod";
import { corpusPath, profilePath, resolveDataDir, voiceBaselineDir } from "./data-dir";
import { stemPhrase, stemTokens } from "./deliverable-audit";
import { cleanText, splitSentences, tokenizeSentence } from "./ngram";
import { parseCorpus, type VoiceDocument } from "./voice-corpus";
import { computeCorpusRates, VoiceDeltaBaseline } from "./voice-delta";

// Word n-gram sizes the profile records. Unigrams cover single-word tells
// (e.g. "cleanly"); bigrams and trigrams cover phrase tells (e.g. "source of
// truth", up to 3 words). Phrases longer than 3 words are matched by their
// leading trigram (see phraseProfileMatch).
export const PROFILE_SIZES = [1, 2, 3] as const;

const NgramCounts = z.record(z.string(), z.record(z.string(), z.number()));

export const VoiceProfile = z.object({
  documentCount: z.number(),
  totalTokens: z.number(),
  // n-gram size -> phrase -> count. Stored as plain objects for JSON. Built from
  // unstemmed tokens; the candidate-additions path looks these up directly.
  ngrams: NgramCounts,
  // Same shape, but built from Porter-stemmed tokens via the deliverable-audit
  // stemming. The deliverable rule-health path looks these up so an inflected
  // baseline phrase ("fails loudly") matches the rule's stem ("fail loudli"),
  // mirroring how auditDeliverableCorpus stems the model's deliverable corpus.
  stemmedNgrams: NgramCounts,
  // Stemmed token count, the denominator for stemmed per-million rates. Differs
  // from totalTokens because the two tokenizers split prose differently.
  totalStemmedTokens: z.number(),
  generatedAt: z.string(),
  sources: z.array(z.string()),
  // Voice-delta aggregate stats from the baseline corpus. Optional: profiles
  // built before this field was added will not have it. Callers should treat
  // its absence as "no baseline for voice-delta features".
  voiceDelta: VoiceDeltaBaseline.optional(),
});
export type VoiceProfile = z.infer<typeof VoiceProfile>;

export type { VoiceDeltaBaseline };

export function buildProfile(docs: VoiceDocument[], generatedAt: string): VoiceProfile {
  const ngrams = new Map<number, Map<string, number>>(PROFILE_SIZES.map((n) => [n, new Map()]));
  const stemmedNgrams = new Map<number, Map<string, number>>(
    PROFILE_SIZES.map((n) => [n, new Map()]),
  );
  let totalTokens = 0;
  let totalStemmedTokens = 0;
  const sources = new Set<string>();

  for (const doc of docs) {
    sources.add(hostOf(doc.source));
    for (const sentence of splitSentences(cleanText(doc.body))) {
      const tokens = tokenizeSentence(sentence);
      if (tokens.length === 0) continue;
      totalTokens += tokens.length;
      addNgramCounts(ngrams, tokens);
    }
    const stemmed = stemTokens(doc.body);
    totalStemmedTokens += stemmed.length;
    addNgramCounts(stemmedNgrams, stemmed);
  }

  const corpusRates = computeCorpusRates(docs.map((d) => d.body));
  const voiceDelta: VoiceDeltaBaseline = {
    rates: Object.fromEntries([...corpusRates.entries()].map(([id, fr]) => [id, fr.rate])),
    documentCount: docs.length,
    computedAt: generatedAt,
  };

  return {
    documentCount: docs.length,
    totalTokens,
    ngrams: serializeNgrams(ngrams),
    stemmedNgrams: serializeNgrams(stemmedNgrams),
    totalStemmedTokens,
    generatedAt,
    sources: Array.from(sources).toSorted(),
    voiceDelta,
  };
}

function addNgramCounts(ngrams: Map<number, Map<string, number>>, tokens: string[]): void {
  for (const n of PROFILE_SIZES) {
    const counts = ngrams.get(n);
    if (!counts) continue;
    for (let i = 0; i + n <= tokens.length; i++) {
      const key = tokens.slice(i, i + n).join(" ");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
}

function serializeNgrams(
  ngrams: Map<number, Map<string, number>>,
): Record<string, Record<string, number>> {
  const serialized: Record<string, Record<string, number>> = {};
  for (const [n, counts] of ngrams) {
    serialized[String(n)] = Object.fromEntries(counts);
  }
  return serialized;
}

export function buildProfileFromCorpus(corpusText: string, generatedAt: string): VoiceProfile {
  return buildProfile(parseCorpus(corpusText), generatedAt);
}

export async function loadProfile(path: string): Promise<VoiceProfile | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  return VoiceProfile.parse(await file.json());
}

export interface PhraseProfileStat {
  count: number;
  perMillion: number;
}

// Look up how often a phrase appears in the voice profile (UNstemmed). The
// phrase is tokenized the same way the unstemmed profile was built. Phrases up
// to PROFILE_SIZES.max are looked up directly; longer phrases use their leading
// trigram as a proxy (the profile only stores up to trigrams). A count of 0 is
// the strong "absent from my baseline" tell signal. This feeds the
// candidate-additions path, which is intentionally unstemmed.
export function phraseProfileStat(profile: VoiceProfile, phrase: string): PhraseProfileStat {
  const tokens = tokenizeSentence(cleanText(phrase));
  if (tokens.length === 0 || profile.totalTokens === 0) {
    return { count: 0, perMillion: 0 };
  }
  return lookupNgram(profile.ngrams, tokens, profile.totalTokens);
}

// Stemmed variant of phraseProfileStat. The phrase is stemmed the same way
// auditDeliverableCorpus stems its needles, and looked up against the profile's
// stemmed n-grams, so an inflected baseline phrase ("fails loudly") matches the
// rule's stem. This feeds the deliverable rule-health comparison, keeping the
// model and baseline sides stem-consistent.
export function phraseProfileStatStemmed(profile: VoiceProfile, phrase: string): PhraseProfileStat {
  const tokens = stemPhrase(phrase);
  if (tokens.length === 0 || profile.totalStemmedTokens === 0) {
    return { count: 0, perMillion: 0 };
  }
  return lookupNgram(profile.stemmedNgrams, tokens, profile.totalStemmedTokens);
}

function lookupNgram(
  ngrams: Record<string, Record<string, number>>,
  tokens: string[],
  totalTokens: number,
): PhraseProfileStat {
  const maxSize = Math.max(...PROFILE_SIZES);
  const size = Math.min(tokens.length, maxSize);
  const key = tokens.slice(0, size).join(" ");
  const count = ngrams[String(size)]?.[key] ?? 0;
  return { count, perMillion: (count / totalTokens) * 1_000_000 };
}

// Derive a coarse source label from a document pointer for the profile's
// provenance list. A GitHub PR URL becomes "github"; anything else is "other".
function hostOf(source: string): string {
  if (/github\.com/.test(source)) return "github";
  return "other";
}

if (import.meta.main) {
  const argv = cli({
    name: "voice-profile",
    flags: {
      dataDir: {
        type: String,
        description:
          "Local data dir for the voice baseline (default: CLAUDE_PLUGIN_DATA or ~/.claude/plugins/data/writing-bendrucker)",
      },
    },
  });

  const dataDir = resolveDataDir(argv.flags.dataDir);
  const corpus = corpusPath(dataDir);
  if (!(await Bun.file(corpus).exists())) {
    throw new Error(`No voice corpus at ${corpus}. Run ingest-voice.ts first.`);
  }

  const today = new Date().toISOString().slice(0, 10);
  const profile = buildProfileFromCorpus(await Bun.file(corpus).text(), today);
  mkdirSync(voiceBaselineDir(dataDir), { recursive: true });
  const out = profilePath(dataDir);
  await Bun.write(out, `${JSON.stringify(profile, null, 2)}\n`);
  console.error(
    `Built profile: ${profile.documentCount} documents, ${profile.totalTokens.toLocaleString()} tokens, sources=${profile.sources.join("+")}`,
  );
  process.stdout.write(`${out}\n`);
}
