#!/usr/bin/env bun
// Measure how much of a Fightin' Words ranking the shipped detectors cover, in
// both directions: discovered terms the detectors match, and curated entries the
// ranking independently places.

import { cli } from "cleye";
import {
  type DetectorLayer,
  PATTERNS,
  scanAudit,
  WEIGHTED_PATTERNS,
} from "../../../detection/tropes";
import {
  parseLines,
  readWordlist,
  stemmedPhraseHits,
  weightedStemHits,
  WORDLISTS,
} from "../../../detection/wordlists";
import { contrastCorpusPath, registerPaths, resolveDataDir, voiceBaselineDir } from "./data-dir";
import { rank, type RankedTerm, stemTerm, tokenizeCorpus } from "./fightin-words";
import { parseCorpus, type VoiceDocument } from "./voice-corpus";

const LAYER_BY_CATEGORY = new Map<string, DetectorLayer>(
  [...PATTERNS, ...WEIGHTED_PATTERNS].map((pattern) => [pattern.category, pattern.layer]),
);

// Ranked terms are lowercased, while the openers list is compiled case-sensitive
// for line-initial matching.
const OPENERS_ANY_CASE =
  WORDLISTS.openers === null || WORDLISTS.openers.flags.includes("i")
    ? WORDLISTS.openers
    : new RegExp(WORDLISTS.openers.source, `${WORDLISTS.openers.flags}i`);

export interface Coverage {
  /** A curated wordlists/*.txt entry matches the term itself. */
  wordlist: boolean;
  /** Any vocabulary-layer detector fires on the term itself. */
  lexical: boolean;
  /** Categories of every detector firing on the sentence the term came from. */
  categories: string[];
}

function matchesWordlist(term: string): boolean {
  if (WORDLISTS.vocabulary(term).count > 0) return true;
  if (stemmedPhraseHits(term, WORDLISTS.floweryPhrases).count > 0) return true;
  if (weightedStemHits(term, WORDLISTS.marketingVerbs).totalWeight > 0) return true;
  if (weightedStemHits(term, WORDLISTS.softPhrasing).totalWeight > 0) return true;
  if (OPENERS_ANY_CASE !== null) {
    OPENERS_ANY_CASE.lastIndex = 0;
    if (OPENERS_ANY_CASE.test(`${term},`)) return true;
  }
  return false;
}

export function coverageOf(term: string, example: string): Coverage {
  const onTerm = scanAudit(term);
  const onSentence = example === "" ? [] : scanAudit(example);
  return {
    wordlist: matchesWordlist(term),
    lexical: onTerm.some((match) => LAYER_BY_CATEGORY.get(match.category) === "vocabulary"),
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
    sentence: rows.filter((row) => row.coverage.categories.length > 0).length,
  };
}

export interface CuratedRecall {
  entry: string;
  rankIndex: number | null;
  z: number | null;
}

// An entry the contrast scores near zero is one the corpus does not support.
export function recallOfCuratedEntries(
  curated: string[],
  ranked: RankedTerm[],
  topN: number,
): CuratedRecall[] {
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

const WEIGHT_SUFFIX = /\s+[0-9]+(?:\.[0-9]+)?$/;

export function curatedEntries(plain: string[], weighted: string[]): string[] {
  return [
    ...plain.flatMap(parseLines),
    ...weighted.flatMap(parseLines).map((line) => line.replace(WEIGHT_SUFFIX, "")),
  ];
}

const PLAIN_LISTS = ["vocabulary.txt", "flowery-phrases.txt", "openers.txt"];
const WEIGHTED_LISTS = ["marketing-verbs.txt", "soft-phrasing.txt"];

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
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`No corpus at ${path}`);
  return parseCorpus(await file.text());
}

function pct(part: number, whole: number): string {
  if (whole === 0) return "0%";
  return `${((part / whole) * 100).toFixed(1)}%`;
}

export interface OverlapReport {
  studyPath: string;
  studyDocs: number;
  studyTokens: number;
  baselineNames: string[];
  baselineDocs: number;
  baselineTokens: number;
  prior: number;
  sizes: number[];
  minCount: number;
  minDocs: number;
  summary: OverlapSummary;
  nullTop: RankedTerm[];
  recall: CuratedRecall[];
  curatedPool: number;
  measured: MeasuredTerm[];
  show: number;
}

export function renderReport(report: OverlapReport): string {
  const { summary } = report;
  const lines = [
    `corpus A  ${report.studyDocs} docs, ${report.studyTokens.toLocaleString()} tokens  ${report.studyPath}`,
    `corpus B  ${report.baselineDocs} docs, ${report.baselineTokens.toLocaleString()} tokens  ${report.baselineNames.join(", ")}`,
    `prior ${report.prior}  sizes ${report.sizes.join(",")}  min-count ${report.minCount}  min-docs ${report.minDocs}`,
    "",
    `top ${summary.considered} discovered terms`,
    `  matched by a curated wordlist entry     ${summary.wordlist} (${pct(summary.wordlist, summary.considered)})`,
    `  matched by any vocabulary-layer rule    ${summary.lexical} (${pct(summary.lexical, summary.considered)})`,
    `  example sentence trips any rule at all  ${summary.sentence} (${pct(summary.sentence, summary.considered)})`,
    "",
    `null control (corpus A split in half): max z=${report.nullTop[0]?.z.toFixed(2) ?? "n/a"}, ` +
      `top terms ${report.nullTop.map((row) => row.term).join(", ")}`,
    "",
    `curated entries, ranked over ${report.curatedPool.toLocaleString()} terms at min-count 1`,
    ...report.recall.map((row) => {
      const position =
        row.rankIndex === null
          ? "absent from corpus A"
          : `#${(row.rankIndex + 1).toLocaleString()}`;
      const score = row.z === null ? "" : `  z=${row.z.toFixed(2)}`;
      return `  ${row.entry.padEnd(20)} ${position}${score}`;
    }),
    "",
    `top ${report.show} by z`,
  ];
  for (const [index, { row, coverage }] of report.measured.slice(0, report.show).entries()) {
    const marks = `${coverage.wordlist ? "W" : "-"}${coverage.lexical ? "L" : "-"}${coverage.categories.length > 0 ? "S" : "-"}`;
    lines.push(
      `${String(index + 1).padStart(3)}. ${marks}  z=${row.z.toFixed(1).padStart(6)}  ` +
        `${row.countA}/${row.countB} in ${row.docs} docs  ${row.term}`,
    );
  }
  return lines.join("\n");
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
      minDocs: { type: Number, default: 3, description: "Minimum corpus A documents per term" },
      top: { type: Number, default: 200, description: "Ranked terms to measure" },
      show: { type: Number, default: 40, description: "Ranked terms to print" },
      json: { type: Boolean, description: "Emit the measurement as JSON" },
    },
  });

  const dataDir = resolveDataDir(argv.flags.dataDir);
  const sizes = argv.flags.sizes.length > 0 ? argv.flags.sizes : [1, 2];
  const studyPath = argv.flags.study ?? contrastCorpusPath(dataDir);
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

  const filter = argv.flags.studyFilter === undefined ? null : new RegExp(argv.flags.studyFilter);
  const [studyAll, ...perRegister] = await Promise.all([
    readCorpus(studyPath),
    ...baselinePaths.map(readCorpus),
  ]);
  const studyDocs = filter === null ? studyAll : studyAll.filter((doc) => filter.test(doc.source));
  const baselineDocs = perRegister.flat();

  // Min-count 1 over sizes 1 through 3 so every curated entry gets a position,
  // including the three-word phrases. Tokenize once at the union of both.
  const curatedSizes = [1, 2, 3];
  const allSizes = [...new Set([...sizes, ...curatedSizes])].toSorted((x, y) => x - y);
  const a = tokenizeCorpus(studyDocs, allSizes);
  const b = tokenizeCorpus(baselineDocs, allSizes);

  const { prior, minCount, minDocs } = argv.flags;
  const ranked = rank(a, b, { sizes, prior, minCount, minDocs });
  const measured: MeasuredTerm[] = ranked.slice(0, argv.flags.top).map((row) => ({
    row,
    coverage: coverageOf(row.term, row.example),
  }));

  const [leftDocs, rightDocs] = splitHalves(studyDocs);
  const nullRanked = rank(tokenizeCorpus(leftDocs, sizes), tokenizeCorpus(rightDocs, sizes), {
    sizes,
    prior,
    minCount,
    minDocs,
  });

  const [plain, weighted] = await Promise.all([
    Promise.all(PLAIN_LISTS.map(readWordlist)),
    Promise.all(WEIGHTED_LISTS.map(readWordlist)),
  ]);
  const curated = curatedEntries(plain, weighted);
  const fullRanked = rank(a, b, { sizes: curatedSizes, prior, minCount: 1, minDocs: 1 });
  const recall = recallOfCuratedEntries(curated, fullRanked, fullRanked.length);

  if (argv.flags.json) {
    // Examples carry verbatim corpus prose, which stays out of any file.
    const terms = measured.map(({ row: { example, ...row }, coverage }) => ({ row, coverage }));
    process.stdout.write(
      `${JSON.stringify({ summary: summarize(measured), recall, terms }, null, 2)}\n`,
    );
  } else {
    process.stdout.write(
      `${renderReport({
        studyPath,
        studyDocs: studyDocs.length,
        studyTokens: a.tokens,
        baselineNames,
        baselineDocs: baselineDocs.length,
        baselineTokens: b.tokens,
        prior,
        sizes,
        minCount,
        minDocs,
        summary: summarize(measured),
        nullTop: nullRanked.slice(0, 5),
        recall,
        curatedPool: fullRanked.length,
        measured,
        show: argv.flags.show,
      })}\n`,
    );
  }
}
