#!/usr/bin/env bun
// claude:dangerouslyDisableSandbox: writes statistics.json under the plugin
// data dir in ~/.claude/plugins, which the sandbox denies.

// Sections write independently and merge into whatever is already on disk.
// The tag signatures cost minutes of tagging, so refreshing the run-log
// numbers alone must not drop them.

import { mkdirSync } from "node:fs";
// oxlint-disable-next-line no-restricted-imports -- Bun has no rename, and only a rename replaces the file atomically.
import { rename } from "node:fs/promises";
import { dirname } from "node:path";
import { cli } from "cleye";
import { resolveLogPath } from "../../../hooks/run-log";
import { CORPUS_FLAGS, selectCorpora } from "./corpus-selection";
import { resolveDataDir, statisticsPath } from "./data-dir";
import { rank, type TokenizedCorpus, tokenizeCorpus } from "./fightin-words";
import { acceptance, readLog, summarize } from "./hook-health";
import { bandError, featureFloors, type LengthBand, withinLength } from "./rate-nulls";
import {
  byBand,
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
  // A merge reads the sections it is not rebuilding off the existing file, so
  // an unreadable one silently narrows this run to the sections it computes.
  // Say so: the tag signatures it would drop cost minutes to mine.
  if (existing === null && (await Bun.file(out).exists())) {
    console.error(`Ignoring unreadable ${out}. Sections not rebuilt here are dropped.`);
  }

  let rateNulls: RateNulls | undefined = existing?.rateNulls;
  let tagSignatures: TagSignatures | undefined = existing?.tagSignatures;
  let hookHealth: HookAcceptance | undefined = existing?.hookHealth;

  // Checked ahead of the corpus tagging, which costs minutes. An unreadable
  // run log then fails before that work is thrown away.
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

  // Re-read here rather than trusting the copy taken before the tagging. Two
  // runs rebuilding different sections both start from the artifact as it was
  // minutes ago, and the one that finishes second would otherwise write the
  // other's section back to the state it read. A section this run computed
  // wins. Every other section comes off the newest file on disk.
  const latest = (await loadStatistics(out)) ?? existing;
  const keep = <T>(section: Section, computed: T | undefined, disk: T | undefined) =>
    wanted.has(section) ? computed : (disk ?? computed);

  const statistics: WritingStatistics = { generatedAt: new Date().toISOString() };
  const merged = {
    rateNulls: keep("rate-nulls", rateNulls, latest?.rateNulls),
    tagSignatures: keep("tag-signatures", tagSignatures, latest?.tagSignatures),
    hookHealth: keep("hook-health", hookHealth, latest?.hookHealth),
  };
  if (merged.rateNulls !== undefined) statistics.rateNulls = merged.rateNulls;
  if (merged.tagSignatures !== undefined) statistics.tagSignatures = merged.tagSignatures;
  if (merged.hookHealth !== undefined) statistics.hookHealth = merged.hookHealth;

  mkdirSync(dirname(out), { recursive: true });
  // Rename rather than write in place, so a scan reading concurrently sees
  // either the old artifact or the new one and never a half-written file.
  const staging = `${out}.${process.pid}.tmp`;
  await Bun.write(staging, `${JSON.stringify(statistics, null, 2)}\n`);
  await rename(staging, out);
  console.log(out);
}
