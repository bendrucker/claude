#!/usr/bin/env bun
// Part-of-speech tag sequences ranked by log-odds with an informative Dirichlet
// prior, each scored against a split-half null floor. Monroe, Colaresi & Quinn
// (2008), "Fightin' Words: Lexical Feature Selection and Evaluation for
// Identifying the Content of Political Conflict", section 3.5.

import { cli } from "cleye";
import {
  CORPUS_FLAGS,
  corpusHeader,
  type CorpusHeader,
  corpusHeaderLines,
  selectCorpora,
} from "./corpus-selection";
import { rank, type RankedTerm, type RankOptions, tokenizeCorpus } from "./fightin-words";
import { tagSequence } from "./tag-ngram";
import { splitHalves, type VoiceDocument } from "./voice-corpus";

// The tagger costs about a minute over the study corpus, and the null re-reads
// sentences the ranking already tagged.
export function cachingTagger(
  tag: (sentence: string) => string[] = tagSequence,
): (sentence: string) => string[] {
  const cache = new Map<string, string[]>();
  return (sentence) => {
    const cached = cache.get(sentence);
    if (cached !== undefined) return cached;
    const tags = tag(sentence);
    cache.set(sentence, tags);
    return tags;
  };
}

/** Largest z the ranked corpus reaches against itself, keyed by n-gram size. */
export type SizeFloor = Map<number, number>;

// Splitting the ranked population against itself gives the null: the largest z
// reachable with no difference to find. The ranking pools every selected kind,
// so the split pools them too. A maximum taken over per-kind maxima bounds no
// single population: it tracks whichever kind's draw spiked, which at 5-grams
// runs a full point above the pooled null and at 3-grams a third of a point
// below it. Sequences of different lengths draw on different amounts of corpus
// mass, so each size carries its own floor.
export function nullFloor(
  docs: VoiceDocument[],
  options: RankOptions,
  tokenize: (sentence: string) => string[],
): SizeFloor {
  const bySize: SizeFloor = new Map();
  if (docs.length < 2) return bySize;
  const [left, right] = splitHalves(docs);
  const ranked = rank(
    tokenizeCorpus(left, options.sizes, tokenize),
    tokenizeCorpus(right, options.sizes, tokenize),
    options,
  );
  for (const row of ranked) {
    const best = bySize.get(row.n);
    if (best === undefined || row.z > best) bySize.set(row.n, row.z);
  }
  return bySize;
}

export interface Signature {
  row: RankedTerm;
  /** Null where the split produced no shape of this size, which leaves it ungated. */
  floor: number | null;
}

export function aboveFloor(ranked: RankedTerm[], bySize: SizeFloor): Signature[] {
  return ranked
    .map((row) => ({ row, floor: bySize.get(row.n) ?? null }))
    .filter((signature) => signature.floor === null || signature.row.z > signature.floor);
}

function formatFloor(z: number | undefined): string {
  return z === undefined ? "n/a" : z.toFixed(1);
}

export interface SignatureReport extends CorpusHeader {
  floor: SizeFloor;
  splitDocs: number;
  sizes: number[];
  prior: number;
  minCount: number;
  minDocs: number;
  ranked: number;
  signatures: Signature[];
  show: number;
}

export function renderReport(report: SignatureReport): string {
  const lines = [
    ...corpusHeaderLines(report),
    `prior ${report.prior}  sizes ${report.sizes.join(",")}  ` +
      `min-count ${report.minCount}  min-docs ${report.minDocs}`,
    "",
    `null floor (corpus A split against itself, ${report.splitDocs} docs)`,
    `  ${report.sizes.map((n) => `${n}-gram ${formatFloor(report.floor.get(n))}`).join("  ")}`,
    "",
    `${report.signatures.length} of ${report.ranked} shapes clear their floor, top ${report.show} by z`,
  ];
  for (const [index, signature] of report.signatures.slice(0, report.show).entries()) {
    const { row, floor } = signature;
    lines.push(
      `${String(index + 1).padStart(3)}. z=${row.z.toFixed(1).padStart(6)}  ` +
        `floor=${(floor === null ? "n/a" : floor.toFixed(1)).padStart(5)}  ` +
        `${row.countA}/${row.countB} in ${row.docs} docs  ${row.term}`,
    );
    if (row.example !== "") lines.push(`     ${row.example}`);
  }
  return lines.join("\n");
}

if (import.meta.main) {
  const argv = cli({
    name: "tag-signatures",
    // A mistyped flag would otherwise be ignored, and the report would answer a
    // different question than the one asked.
    strictFlags: true,
    help: {
      description:
        "Rank part-of-speech tag sequences in agent-authored prose against the pre-agent " +
        "voice baseline by log-odds with an informative Dirichlet prior, and drop the " +
        "shapes a same-author split of the corpus reaches on its own.",
    },
    flags: {
      ...CORPUS_FLAGS,
      sizes: { type: [Number], description: "Tag n-gram sizes. Default: 3, 4 and 5" },
      prior: { type: Number, default: 500, description: "Dirichlet concentration (alpha-0)" },
      minCount: { type: Number, default: 30, description: "Minimum occurrences in corpus A" },
      minDocs: { type: Number, default: 3, description: "Minimum corpus A documents per shape" },
      show: { type: Number, default: 40, description: "Shapes to print" },
      json: { type: Boolean, description: "Emit the measurement as JSON" },
    },
  });

  const sizes = argv.flags.sizes.length > 0 ? argv.flags.sizes : [3, 4, 5];
  const selection = await selectCorpora(argv.flags);
  const { study, baseline } = selection;
  const tokenize = cachingTagger();

  const { prior, minCount, minDocs } = argv.flags;
  const options = { sizes, prior, minCount, minDocs };
  const a = tokenizeCorpus(study.documents, sizes, tokenize);
  const b = tokenizeCorpus(baseline.documents, sizes, tokenize);
  const ranked = rank(a, b, options);
  const sizeFloor = nullFloor(study.documents, options, tokenize);
  const signatures = aboveFloor(ranked, sizeFloor);

  if (argv.flags.json) {
    // Examples carry verbatim corpus prose, which stays out of any file.
    const shapes = signatures.map(({ row: { example, ...row }, floor }) => ({ row, floor }));
    process.stdout.write(
      `${JSON.stringify(
        {
          kinds: study.kinds,
          splitDocs: study.documents.length,
          floor: Object.fromEntries(sizeFloor),
          ranked: ranked.length,
          shapes,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    process.stdout.write(
      `${renderReport({
        ...corpusHeader(selection, { study: a.tokens, baseline: b.tokens }),
        floor: sizeFloor,
        splitDocs: study.documents.length,
        sizes,
        prior,
        minCount,
        minDocs,
        ranked: ranked.length,
        signatures,
        show: argv.flags.show,
      })}\n`,
    );
  }
}
