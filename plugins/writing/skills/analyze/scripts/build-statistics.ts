#!/usr/bin/env bun
// claude:dangerouslyDisableSandbox: writes statistics.json under the plugin
// data dir in ~/.claude/plugins, which the sandbox denies.

// Takes the three measurements the analyze reports print and persists them to
// the plugin data dir, where the scan surfaces read them. The corpora and the
// run log stay on this machine, so the artifact is the only part that travels,
// and it travels no further than the data dir.
//
// Sections write independently and merge into whatever is already on disk. The
// tag signatures cost minutes of tagging, so refreshing the run-log numbers
// alone must not drop them.

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { cli } from "cleye";
import { resolveLogPath } from "../../../hooks/run-log";
import { CORPUS_FLAGS, selectCorpora } from "./corpus-selection";
import { resolveDataDir, statisticsPath } from "./data-dir";
import { rank, type TokenizedCorpus, tokenizeCorpus } from "./fightin-words";
import { acceptance, readLog, summarize } from "./hook-health";
import { bandError, featureFloors, type LengthBand, withinLength } from "./rate-nulls";
import {
  describeBand,
  type HookAcceptance,
  loadStatistics,
  type RateNullRun,
  type RateNulls,
  sameBand,
  type TagSignatures,
  type WritingStatistics,
} from "./statistics";
import { aboveFloor, cachingTagger, nullFloor } from "./tag-signatures";

const SECTIONS = ["rate-nulls", "tag-signatures", "hook-health"] as const;
type Section = (typeof SECTIONS)[number];

function isSection(value: string): value is Section {
  return (SECTIONS as readonly string[]).includes(value);
}

function bandWidth(run: RateNullRun): number {
  return (run.maxWords ?? Number.POSITIVE_INFINITY) - (run.minWords ?? 0);
}

/** Widest band first, so the full corpus leads the runs a report prints. */
function byBand(a: RateNullRun, b: RateNullRun): number {
  return bandWidth(b) - bandWidth(a);
}

/** Share of a corpus's tag n-grams, at the measured sizes, landing on a confirmed shape. */
function shapeShare(corpus: TokenizedCorpus, sizes: number[], shapes: Set<string>): number {
  let hits = 0;
  let total = 0;
  for (const size of sizes) {
    for (const [shape, count] of corpus.ngrams.get(size) ?? []) {
      total += count;
      if (shapes.has(shape)) hits += count;
    }
  }
  return total === 0 ? 0 : hits / total;
}

if (import.meta.main) {
  const argv = cli({
    name: "build-statistics",
    strictFlags: true,
    help: {
      description:
        "Measure the voice-delta rate floors, the part-of-speech signatures, and the hook run log, and write them to statistics.json in the plugin data dir for scan to read.",
    },
    flags: {
      ...CORPUS_FLAGS,
      section: {
        type: [String],
        description: `Sections to rebuild. Repeatable. Default: all of ${SECTIONS.join(", ")}`,
      },
      splits: { type: Number, default: 500, description: "Random splits of corpus B" },
      percentile: { type: Number, default: 95, description: "Floor percentile across splits" },
      seed: { type: Number, default: 1, description: "PRNG seed" },
      minWords: { type: Number, description: "Keep only documents of at least this many words" },
      maxWords: { type: Number, description: "Keep only documents of at most this many words" },
      sizes: { type: [Number], description: "Tag n-gram sizes. Default: 3, 4 and 5" },
      prior: { type: Number, default: 500, description: "Dirichlet concentration (alpha-0)" },
      minCount: { type: Number, default: 30, description: "Minimum occurrences in corpus A" },
      minDocs: { type: Number, default: 3, description: "Minimum corpus A documents per shape" },
      log: {
        type: String,
        description:
          "Run log path (default: WRITING_HOOKS_LOG or ~/.claude/writing-hooks/log.jsonl)",
      },
      since: {
        type: String,
        description: "Only count run-log entries at or after this date (ISO)",
      },
    },
  });

  const named = argv.flags.section.map((value) => {
    if (!isSection(value)) {
      console.error(`Unknown section ${value}. One of ${SECTIONS.join(", ")}.`);
      process.exit(1);
    }
    return value;
  });
  const wanted = new Set<Section>(named.length > 0 ? named : SECTIONS);

  const band: LengthBand = { min: argv.flags.minWords, max: argv.flags.maxWords };
  const invalid = bandError(band);
  if (invalid !== null) {
    console.error(invalid);
    process.exit(1);
  }

  const dataDir = resolveDataDir(argv.flags.dataDir);
  const out = statisticsPath(dataDir);
  const existing = await loadStatistics(out);

  let rateNulls: RateNulls | undefined = existing?.rateNulls;
  let tagSignatures: TagSignatures | undefined = existing?.tagSignatures;
  let hookHealth: HookAcceptance | undefined = existing?.hookHealth;

  if (wanted.has("rate-nulls") || wanted.has("tag-signatures")) {
    const selected = await selectCorpora(argv.flags);
    const study = withinLength(selected.study.documents, band);
    const baseline = withinLength(selected.baseline.documents, band);
    for (const [label, documents] of [
      ["A", study],
      ["B", baseline],
    ] as const) {
      if (documents.length > 0) continue;
      console.error(`No corpus ${label} documents for kinds ${selected.study.kinds.join(",")}.`);
      process.exit(1);
    }

    if (wanted.has("rate-nulls")) {
      const options = {
        splits: argv.flags.splits,
        percentile: argv.flags.percentile,
        seed: argv.flags.seed,
      };
      const floors = featureFloors(study, baseline, options);
      const run: RateNullRun = {
        ...options,
        minWords: band.min ?? null,
        maxWords: band.max ?? null,
        floors: floors.map(({ featureId, gap, floor }) => ({ featureId, gap, floor })),
      };
      // Each band answers a different question, so a rebuild replaces the run
      // covering the same band and leaves the others in place.
      const kept = (rateNulls?.runs ?? []).filter((other) => !sameBand(other, run));
      rateNulls = { runs: [...kept, run].toSorted(byBand) };
      console.error(
        `rate-nulls: ${floors.length} features over the ${describeBand(run)} against ${options.splits} splits`,
      );
    }

    if (wanted.has("tag-signatures")) {
      const sizes = argv.flags.sizes.length > 0 ? argv.flags.sizes : [3, 4, 5];
      const { prior, minCount, minDocs } = argv.flags;
      const options = { sizes, prior, minCount, minDocs };
      const tokenize = cachingTagger();
      // The signature ranking pools the study kinds, so the band restricts it
      // the same way it restricts the rate floors: an over-represented shape
      // that only tracks document length is not a voice signature.
      const a = tokenizeCorpus(study, sizes, tokenize);
      const b = tokenizeCorpus(baseline, sizes, tokenize);
      const signatures = aboveFloor(rank(a, b, options), nullFloor(study, options, tokenize));
      const shapes = new Set(signatures.map((signature) => signature.row.term));
      tagSignatures = {
        sizes,
        minWords: band.min ?? null,
        maxWords: band.max ?? null,
        studyShare: shapeShare(a, sizes, shapes),
        baselineShare: shapeShare(b, sizes, shapes),
        shapes: signatures.map(({ row }) => ({ shape: row.term, n: row.n, z: row.z })),
      };
      console.error(`tag-signatures: ${signatures.length} shapes clear their null`);
    }
  }

  if (wanted.has("hook-health")) {
    const path = argv.flags.log ?? resolveLogPath();
    if (path == null || path === "") {
      console.error("Logging is disabled (WRITING_HOOKS_LOG). Pass --log <path>.");
      process.exit(1);
    }
    const entries = await readLog(path, argv.flags.since);
    if (entries.length === 0) {
      console.error(`No run-log entries at ${path}.`);
      process.exit(1);
    }
    const health = summarize(entries);
    const accepts = acceptance(entries);
    hookHealth = {
      runs: health.total,
      spanDays: health.spanDays,
      categories: health.categories.map((category) => ({
        category: category.category,
        fired: category.fired,
        revisited: accepts.get(category.category)?.revisited ?? 0,
        accepted: accepts.get(category.category)?.accepted ?? 0,
      })),
    };
    console.error(`hook-health: ${health.categories.length} categories over ${health.total} runs`);
  }

  const statistics: WritingStatistics = { generatedAt: new Date().toISOString() };
  if (rateNulls !== undefined) statistics.rateNulls = rateNulls;
  if (tagSignatures !== undefined) statistics.tagSignatures = tagSignatures;
  if (hookHealth !== undefined) statistics.hookHealth = hookHealth;

  mkdirSync(dirname(out), { recursive: true });
  await Bun.write(out, `${JSON.stringify(statistics, null, 2)}\n`);
  console.log(out);
}
