// Synthetic corpora for the tests. The real voice baseline is local-only and
// never committed, so every fixture here is generated from word banks with a
// seeded generator: deterministic across runs, and quoting nobody.
//
// The two banks are drawn to differ on the features the prototype found
// separating: sentence length variation, short-sentence share, commas per
// sentence, and contraction rate.

import { buildStyleProfile, type CorpusDocument } from "./build";
import type { StyleProfile } from "./profile";

const VOICE_SENTENCES = [
  "It's a small change.",
  "We don't need the extra flag.",
  "That's the whole fix.",
  "The parser was dropping the last row, so I moved the flush.",
  "Fine by me.",
  "I'd rather keep the old name.",
  "There's no test for the empty case yet.",
  "Let's ship it and see.",
  "The cache warms on the first call.",
  "Won't help much, but it's cheap.",
  "This one bit me twice already.",
  "The hook fires before the write, which is why the count was off.",
  "Good catch.",
  "I've pushed a follow-up.",
  "It reads better as one function.",
  "No rush on this.",
];

const CONTRAST_SENTENCES = [
  "The implementation provides a comprehensive solution that addresses the underlying requirements, ensuring the resulting behavior remains consistent across every supported configuration.",
  "It is important to note that the described approach, while effective in the general case, introduces additional considerations that must be carefully evaluated before adoption.",
  "By leveraging the existing abstraction layer, the proposed modification maintains compatibility with the current interface, reduces duplication, and improves overall maintainability.",
  "The resulting architecture is designed to accommodate future extensions, allowing additional handlers to be registered without modifying the core dispatch logic.",
  "This approach ensures that the validation logic, which previously resided in multiple locations, is consolidated into a single, well-defined boundary.",
  "In order to preserve the established conventions of the surrounding codebase, the naming scheme mirrors that of the adjacent modules, which improves discoverability.",
  "The configuration is resolved at startup, cached for the lifetime of the process, and invalidated whenever the underlying source file is modified.",
  "It should be emphasized that these measurements, while indicative of the general trend, were collected under controlled conditions and may not generalize.",
];

// Mulberry32: a small deterministic generator, so a fixture corpus is identical
// on every run and snapshots stay stable.
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeDocuments(
  bank: string[],
  count: number,
  seed: number,
  label: string,
): CorpusDocument[] {
  const random = seeded(seed);
  const documents: CorpusDocument[] = [];
  for (let i = 0; i < count; i++) {
    const paragraphs: string[] = [];
    for (let p = 0; p < 2 + Math.floor(random() * 2); p++) {
      const sentences: string[] = [];
      for (let s = 0; s < 4 + Math.floor(random() * 4); s++) {
        sentences.push(bank[Math.floor(random() * bank.length)] ?? "");
      }
      paragraphs.push(sentences.join(" "));
    }
    documents.push({ source: `${label}-${i}`, body: paragraphs.join("\n\n") });
  }
  return documents;
}

export function voiceCorpus(count = 40): CorpusDocument[] {
  return makeDocuments(VOICE_SENTENCES, count, 1, "voice");
}

export function contrastCorpus(count = 40): CorpusDocument[] {
  return makeDocuments(CONTRAST_SENTENCES, count, 2, "contrast");
}

// A held-out voice document: the generator is deterministic, so asking for one
// more document than the corpus holds yields a sample the profile never saw.
// Scoring it is the fixture stand-in for scoring the author's own new writing.
export function voiceLikeText(): string {
  return voiceCorpus(41)[40]?.body ?? "";
}

// Fixed, so tests can assert on the passage a window localizer is expected to
// find.
export function contrastLikeText(): string {
  return [CONTRAST_SENTENCES.slice(0, 4).join(" "), CONTRAST_SENTENCES.slice(4, 8).join(" ")].join(
    "\n\n",
  );
}

let cached: StyleProfile | null = null;

export function fixtureProfile(): StyleProfile {
  cached ??= buildStyleProfile(voiceCorpus(), contrastCorpus(), {
    generatedAt: "2026-01-01T00:00:00.000Z",
    vocabularySize: 120,
    minWords: 40,
  }).profile;
  return cached;
}
