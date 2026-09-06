#!/usr/bin/env bun
// Measure how much of a Fightin' Words ranking the shipped detectors cover, in
// both directions: discovered terms the detectors match, and curated entries the
// ranking independently places.

import { cli } from "cleye";
import { stemmedPhraseHits, weightedStemHits, WORDLISTS } from "../../../detection/wordlists";
import { type DetectorLayer, PATTERNS, scan } from "../../../detection/tropes";
import { corpusPath, registerPaths, resolveDataDir, voiceBaselineDir } from "./data-dir";
import { rank, type RankedTerm, stemTerm, tokenizeCorpus } from "./fightin-words";
import { parseCorpus, type VoiceDocument } from "./voice-corpus";

const LAYER_BY_CATEGORY = new Map<string, DetectorLayer>(
  PATTERNS.map((pattern) => [pattern.category, pattern.layer]),
);

export interface Coverage {
  /** A curated wordlists/*.txt entry matches the term itself. */
  wordlist: boolean;
  /** Any vocabulary-layer detector fires on the term itself. */
  lexical: boolean;
  /** Any detector at all fires on the sentence the term was discovered in. */
  sentence: boolean;
  categories: string[];
}

function matchesWordlist(term: string): boolean {
  if (WORDLISTS.vocabulary(term).count > 0) return true;
  if (stemmedPhraseHits(term, WORDLISTS.floweryPhrases).count > 0) return true;
  if (weightedStemHits(term, WORDLISTS.marketingVerbs).totalWeight > 0) return true;
  if (weightedStemHits(term, WORDLISTS.softPhrasing).totalWeight > 0) return true;
  const { openers } = WORDLISTS;
  if (openers !== null) {
    openers.lastIndex = 0;
    if (openers.test(`${term},`)) return true;
  }
  return false;
}

export function coverageOf(term: string, example: string): Coverage {
  const onTerm = scan(term);
  const onSentence = example === "" ? [] : scan(example);
  return {
    wordlist: matchesWordlist(term),
    lexical: onTerm.some((match) => LAYER_BY_CATEGORY.get(match.category) === "vocabulary"),
    sentence: onSentence.length > 0,
    categories: [...new Set(onSentence.map((match) => match.category))],
  };
}

export interface MeasuredTerm {
  row: RankedTerm;
  coverage: Coverage;
}

export interface OverlapSummary {
  considered: number;
  wordlist: number;
  lexical: number;
  sentence: number;
}

export function summarize(rows: MeasuredTerm[]): OverlapSummary {
  return {
    considered: rows.length,
    wordlist: rows.filter((row) => row.coverage.wordlist).length,
    lexical: rows.filter((row) => row.coverage.lexical).length,
    sentence: rows.filter((row) => row.coverage.sentence).length,
  };
}

// Place each curated entry in the ranking. An entry the contrast scores near
// zero is one the corpus does not support.
export function recallOfCuratedEntries(
  curated: string[],
  ranked: RankedTerm[],
  topN: number,
): { entry: string; rankIndex: number | null; z: number | null }[] {
  const positions = new Map<string, { index: number; z: number }>();
  for (const [index, row] of ranked.entries()) {
    const stem = stemTerm(row.term);
    if (!positions.has(stem)) positions.set(stem, { index, z: row.z });
  }
  return curated.map((entry) => {
    const found = positions.get(stemTerm(entry));
    if (found === undefined || found.index >= topN) {
      return { entry, rankIndex: null, z: found?.z ?? null };
    }
    return { entry, rankIndex: found.index, z: found.z };
  });
}

const COMMENT_OR_BLANK = /^\s*(?:#|$)/;

export function curatedEntries(sources: string[]): string[] {
  const entries: string[] = [];
  for (const content of sources) {
    for (const line of content.split(/\r?\n/)) {
      if (COMMENT_OR_BLANK.test(line)) continue;
      const trimmed = line.trim();
      if (trimmed === "") continue;
      // Weighted lists carry a trailing numeric weight.
      entries.push(trimmed.replace(/\s+[0-9]+(?:\.[0-9]+)?$/, ""));
    }
  }
  return entries;
}

function select(docs: VoiceDocument[], sourceFilter: RegExp | null): VoiceDocument[] {
  if (sourceFilter === null) return docs;
  return docs.filter((doc) => sourceFilter.test(doc.source));
}

function bodies(docs: VoiceDocument[]): string {
  return docs.map((doc) => doc.body).join("\n\n");
}

// Alternate documents so both halves draw on the same sessions and dates.
// Contrasting them gives the null: the largest z reachable with no difference to
// find, which is the floor a real term has to clear.
export function splitHalves(docs: VoiceDocument[]): [VoiceDocument[], VoiceDocument[]] {
  const left: VoiceDocument[] = [];
  const right: VoiceDocument[] = [];
  for (const [index, doc] of docs.entries()) {
    (index % 2 === 0 ? left : right).push(doc);
  }
  return [left, right];
}

async function readCorpus(path: string): Promise<VoiceDocument[]> {
  return parseCorpus(await Bun.file(path).text());
}

function pct(part: number, whole: number): string {
  if (whole === 0) return "0%";
  return `${((part / whole) * 100).toFixed(1)}%`;
}

if (import.meta.main) {
  const argv = cli({
    name: "wordlist-overlap",
    help: {
      description:
        "Rank agent-authored prose against the pre-agent voice baseline by log-odds " +
        "with an informative Dirichlet prior, then measure how much of the ranking " +
        "the shipped detectors already cover.",
    },
    flags: {
      dataDir: { type: String, description: "Override the plugin data directory" },
      study: {
        type: String,
        description: "Corpus A (agent-authored). Defaults to the contrast baseline.",
      },
      baseline: {
        type: [String],
        description:
          "Corpus B register filenames. Repeatable. Default: github-prs.txt, github-issues.txt",
      },
      studyFilter: {
        type: String,
        description: "Keep only corpus A documents whose source matches this regex",
      },
      sizes: { type: [Number], description: "N-gram sizes. Default: 1 and 2" },
      prior: { type: Number, default: 500, description: "Dirichlet concentration (alpha-0)" },
      minCount: { type: Number, default: 5, description: "Minimum occurrences in corpus A" },
      top: { type: Number, default: 200, description: "Ranked terms to measure" },
      show: { type: Number, default: 40, description: "Ranked terms to print" },
      json: { type: Boolean, description: "Emit the measurement as JSON" },
    },
  });

  const dataDir = resolveDataDir(argv.flags.dataDir);
  const sizes = argv.flags.sizes.length > 0 ? argv.flags.sizes : [1, 2];
  const studyPath = argv.flags.study ?? `${dataDir}/contrast-baseline/claude-deliverables.txt`;
  const baselineNames =
    argv.flags.baseline.length > 0 ? argv.flags.baseline : ["github-prs.txt", "github-issues.txt"];

  const registers = await registerPaths(dataDir);
  const baselinePaths = baselineNames.map((name) => {
    const found = registers.find((path) => path.endsWith(`/${name}`));
    if (found === undefined) {
      throw new Error(`No register ${name} under ${voiceBaselineDir(dataDir)}`);
    }
    return found;
  });
  if (baselinePaths.length === 0) baselinePaths.push(corpusPath(dataDir));

  const filter = argv.flags.studyFilter === undefined ? null : new RegExp(argv.flags.studyFilter);
  const studyDocs = select(await readCorpus(studyPath), filter);
  const baselineDocs = (await Promise.all(baselinePaths.map(readCorpus))).flat();

  const a = tokenizeCorpus(bodies(studyDocs), sizes);
  const b = tokenizeCorpus(bodies(baselineDocs), sizes);

  const ranked = rank(a, b, {
    sizes,
    prior: argv.flags.prior,
    minCount: argv.flags.minCount,
  });
  const measured: MeasuredTerm[] = [];
  for (const row of ranked.slice(0, argv.flags.top)) {
    measured.push({ row, coverage: coverageOf(row.term, row.example) });
  }
  const summary = summarize(measured);

  const [leftDocs, rightDocs] = splitHalves(studyDocs);
  const nullRanked = rank(
    tokenizeCorpus(bodies(leftDocs), sizes),
    tokenizeCorpus(bodies(rightDocs), sizes),
    { sizes, prior: argv.flags.prior, minCount: argv.flags.minCount },
  );

  // Min-count 1 over sizes 1 through 3 so every entry gets a position, including
  // the three-word phrases.
  const curated = curatedEntries(
    await Promise.all(
      ["vocabulary", "flowery-phrases", "marketing-verbs", "soft-phrasing", "openers"].map((name) =>
        Bun.file(`${import.meta.dirname}/../../../wordlists/${name}.txt`).text(),
      ),
    ),
  );
  const curatedSizes = [1, 2, 3];
  const fullRanked = rank(
    tokenizeCorpus(bodies(studyDocs), curatedSizes),
    tokenizeCorpus(bodies(baselineDocs), curatedSizes),
    { sizes: curatedSizes, prior: argv.flags.prior, minCount: 1 },
  );
  const recall = recallOfCuratedEntries(curated, fullRanked, fullRanked.length);

  if (argv.flags.json) {
    process.stdout.write(
      `${JSON.stringify({ summary, recall, terms: measured, corpora: { a: a.tokens, b: b.tokens } }, null, 2)}\n`,
    );
  } else {
    const nullTop = nullRanked.slice(0, 5);
    const lines = [
      `corpus A  ${studyDocs.length} docs, ${a.tokens.toLocaleString()} tokens  ${studyPath}`,
      `corpus B  ${baselineDocs.length} docs, ${b.tokens.toLocaleString()} tokens  ${baselineNames.join(", ")}`,
      `prior ${argv.flags.prior}  sizes ${sizes.join(",")}  min-count ${argv.flags.minCount}`,
      "",
      `top ${summary.considered} discovered terms`,
      `  matched by a curated wordlist entry     ${summary.wordlist} (${pct(summary.wordlist, summary.considered)})`,
      `  matched by any vocabulary-layer rule    ${summary.lexical} (${pct(summary.lexical, summary.considered)})`,
      `  example sentence trips any rule at all  ${summary.sentence} (${pct(summary.sentence, summary.considered)})`,
      "",
      `null control (corpus A split in half): max z=${nullTop[0]?.z.toFixed(2) ?? "n/a"}, ` +
        `top terms ${nullTop.map((row) => row.term).join(", ")}`,
      "",
      `curated entries, ranked over ${fullRanked.length.toLocaleString()} terms at min-count 1`,
      ...recall.map((row) => {
        const position =
          row.rankIndex === null
            ? "absent from corpus A"
            : `#${(row.rankIndex + 1).toLocaleString()}`;
        const score = row.z === null ? "" : `  z=${row.z.toFixed(2)}`;
        return `  ${row.entry.padEnd(20)} ${position}${score}`;
      }),
      "",
      `top ${argv.flags.show} by z`,
    ];
    for (const [index, { row, coverage }] of measured.slice(0, argv.flags.show).entries()) {
      const marks = `${coverage.wordlist ? "W" : "-"}${coverage.lexical ? "L" : "-"}${coverage.sentence ? "S" : "-"}`;
      lines.push(
        `${String(index + 1).padStart(3)}. ${marks}  z=${row.z.toFixed(1).padStart(6)}  ` +
          `${row.countA}/${row.countB}  ${row.term}`,
      );
    }
    process.stdout.write(`${lines.join("\n")}\n`);
  }
}
