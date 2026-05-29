import { mkdirSync } from "node:fs";
import { cli } from "cleye";
import { corpusPath, profilePath, resolveDataDir, voiceBaselineDir } from "./data-dir";
import { cleanText, splitSentences, tokenizeSentence } from "./ngram";
import { parseCorpus, type VoiceDocument } from "./voice-corpus";

// Word n-gram sizes the profile records. Unigrams cover single-word tells
// (e.g. "cleanly"); bigrams and trigrams cover phrase tells (e.g. "source of
// truth", up to 3 words). Phrases longer than 3 words are matched by their
// leading trigram (see phraseProfileMatch).
export const PROFILE_SIZES = [1, 2, 3] as const;

export interface VoiceProfile {
  documentCount: number;
  totalTokens: number;
  // n-gram size -> phrase -> count. Stored as plain objects for JSON.
  ngrams: Record<string, Record<string, number>>;
  generatedAt: string;
  sources: string[];
}

export function buildProfile(docs: VoiceDocument[], generatedAt: string): VoiceProfile {
  const ngrams = new Map<number, Map<string, number>>(PROFILE_SIZES.map((n) => [n, new Map()]));
  let totalTokens = 0;
  const sources = new Set<string>();

  for (const doc of docs) {
    sources.add(hostOf(doc.source));
    for (const sentence of splitSentences(cleanText(doc.body))) {
      const tokens = tokenizeSentence(sentence);
      if (tokens.length === 0) continue;
      totalTokens += tokens.length;
      for (const n of PROFILE_SIZES) {
        const counts = ngrams.get(n);
        if (!counts) continue;
        for (let i = 0; i + n <= tokens.length; i++) {
          const key = tokens.slice(i, i + n).join(" ");
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
    }
  }

  const serializedNgrams: Record<string, Record<string, number>> = {};
  for (const [n, counts] of ngrams) {
    serializedNgrams[String(n)] = Object.fromEntries(counts);
  }

  return {
    documentCount: docs.length,
    totalTokens,
    ngrams: serializedNgrams,
    generatedAt,
    sources: Array.from(sources).sort(),
  };
}

export function buildProfileFromCorpus(corpusText: string, generatedAt: string): VoiceProfile {
  return buildProfile(parseCorpus(corpusText), generatedAt);
}

export async function loadProfile(path: string): Promise<VoiceProfile | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  return (await file.json()) as VoiceProfile;
}

export interface PhraseProfileStat {
  count: number;
  perMillion: number;
}

// Look up how often a phrase appears in the voice profile. The phrase is
// tokenized the same way the profile was built. Phrases up to PROFILE_SIZES.max
// are looked up directly; longer phrases use their leading trigram as a proxy
// (the profile only stores up to trigrams). A count of 0 is the strong
// "absent from my baseline" tell signal.
export function phraseProfileStat(profile: VoiceProfile, phrase: string): PhraseProfileStat {
  const tokens = tokenizeSentence(cleanText(phrase));
  if (tokens.length === 0 || profile.totalTokens === 0) {
    return { count: 0, perMillion: 0 };
  }
  const maxSize = Math.max(...PROFILE_SIZES);
  const size = Math.min(tokens.length, maxSize);
  const key = tokens.slice(0, size).join(" ");
  const count = profile.ngrams[String(size)]?.[key] ?? 0;
  return { count, perMillion: (count / profile.totalTokens) * 1_000_000 };
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
