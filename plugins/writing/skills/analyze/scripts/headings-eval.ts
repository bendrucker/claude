#!/usr/bin/env bun
/**
 * Heading-classifier evaluation harness (issue #745). Extracts markdown
 * headings from the deliverable-prose corpus, runs every candidate
 * classifier against them, and compares flag rates and agreement with
 * the baseline heuristic. With --sample it emits a labeling file; with
 * --labels it scores precision/recall against hand labels.
 *
 * Corpus artifacts (headings, labels) are written under tmp/ and must
 * never leave the machine: the session corpus spans hosts marked
 * block_egress. Reports that leave the machine carry aggregate numbers
 * and invented examples only.
 *
 * With --docs the corpus is a directory of markdown files instead of
 * the session DB, e.g. a synthetic corpus generated with
 * `claude -p --no-session-persistence`, which is egress-clean and may
 * be quoted freely.
 */
import { mkdirSync, readdirSync } from "node:fs";
import * as path from "node:path";
import { cli } from "cleye";
import type { Heading, Text } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { table } from "table";
import { visit } from "unist-util-visit";
import { CLASSIFIERS } from "../../../linguistics/classifiers";
import type { HeadingClassifier, HeadingKind } from "../../../linguistics/heading";
import { openSessionDb } from "./db";
import type { DeliverableRow } from "./dump";

export interface HeadingRecord {
  heading: string;
  occurrences: number;
  sessions: number;
}

/**
 * Extract heading display text the same way the headings hook does:
 * text children only, all-inline-code headings skipped. The eval
 * distribution matches what the hook sees in production.
 */
export function extractHeadings(markdown: string): string[] {
  let ast: ReturnType<typeof fromMarkdown>;
  try {
    ast = fromMarkdown(markdown);
  } catch {
    return [];
  }
  const headings: string[] = [];
  visit(ast, "heading", (node: Heading) => {
    if (node.children.length === 0) return;
    const allCode = node.children.every((child) => child.type === "inlineCode");
    if (allCode) return;
    const display = node.children
      .filter((child): child is Text => child.type === "text")
      .map((child) => child.value)
      .join("")
      .trim();
    if (display.length > 0) headings.push(display);
  });
  return headings;
}

export function dedupeHeadings(
  rows: Array<{ session_id: string; text?: string }>,
): HeadingRecord[] {
  const byHeading = new Map<string, { occurrences: number; sessions: Set<string> }>();
  for (const row of rows) {
    if (!row.text) continue;
    for (const heading of extractHeadings(row.text)) {
      let record = byHeading.get(heading);
      if (!record) {
        record = { occurrences: 0, sessions: new Set() };
        byHeading.set(heading, record);
      }
      record.occurrences++;
      record.sessions.add(row.session_id);
    }
  }
  return Array.from(byHeading, ([heading, { occurrences, sessions }]) => ({
    heading,
    occurrences,
    sessions: sessions.size,
  })).sort((a, b) => b.occurrences - a.occurrences);
}

export interface ClassifierStats {
  name: string;
  flags: number;
  flagRate: number;
  agreement: number;
  disagreements: number;
}

export interface Evaluation {
  stats: ClassifierStats[];
  /** Headings where at least one candidate disagrees with the baseline. */
  disagreements: string[];
  verdicts: Map<string, Map<string, boolean>>;
}

export function evaluateClassifiers(
  headings: HeadingRecord[],
  classifiers: HeadingClassifier[],
): Evaluation {
  const baseline = classifiers[0];
  if (!baseline) throw new Error("no classifiers given");

  const verdicts = new Map<string, Map<string, boolean>>();
  const disagreements: string[] = [];

  for (const { heading } of headings) {
    const row = new Map<string, boolean>();
    for (const classifier of classifiers) {
      row.set(classifier.name, classifier.classify(heading).flagged);
    }
    verdicts.set(heading, row);
    const base = row.get(baseline.name);
    if (Array.from(row.values()).some((flagged) => flagged !== base)) {
      disagreements.push(heading);
    }
  }

  const stats = classifiers.map((classifier) => {
    let flags = 0;
    let agree = 0;
    let disagree = 0;
    for (const row of verdicts.values()) {
      const flagged = row.get(classifier.name) ?? false;
      const base = row.get(baseline.name) ?? false;
      if (flagged) flags++;
      if (flagged === base) agree++;
      else disagree++;
    }
    const n = verdicts.size;
    return {
      name: classifier.name,
      flags,
      flagRate: n > 0 ? flags / n : 0,
      agreement: n > 0 ? agree / n : 1,
      disagreements: disagree,
    };
  });

  return { stats, disagreements, verdicts };
}

/** Wilson score interval for a binomial proportion (95%). */
export function wilson(successes: number, n: number): { lo: number; hi: number } {
  if (n === 0) return { lo: 0, hi: 1 };
  const z = 1.96;
  const p = successes / n;
  const denom = 1 + z ** 2 / n;
  const center = (p + z ** 2 / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + z ** 2 / (4 * n ** 2))) / denom;
  return { lo: Math.max(0, center - margin), hi: Math.min(1, center + margin) };
}

export const LABELS: HeadingKind[] = [
  "noun-phrase",
  "clause",
  "imperative",
  "interrogative",
  "fragment",
];

export const SHOULD_FLAG = new Set<HeadingKind>(["clause", "imperative"]);

export interface LabeledHeading {
  heading: string;
  label: HeadingKind;
  source: "random" | "disagreement";
}

export interface PrecisionRecall {
  name: string;
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  precisionLo: number;
  precisionHi: number;
  recall: number;
}

export function scoreAgainstLabels(
  labeled: LabeledHeading[],
  classifiers: HeadingClassifier[],
): PrecisionRecall[] {
  return classifiers.map((classifier) => {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (const { heading, label } of labeled) {
      const flagged = classifier.classify(heading).flagged;
      const want = SHOULD_FLAG.has(label);
      if (flagged && want) tp++;
      else if (flagged && !want) fp++;
      else if (!flagged && want) fn++;
    }
    const ci = wilson(tp, tp + fp);
    return {
      name: classifier.name,
      tp,
      fp,
      fn,
      precision: tp + fp > 0 ? tp / (tp + fp) : 1,
      precisionLo: ci.lo,
      precisionHi: ci.hi,
      recall: tp + fn > 0 ? tp / (tp + fn) : 1,
    };
  });
}

export function parseLabelsFile(content: string): LabeledHeading[] {
  const labeled: LabeledHeading[] = [];
  for (const line of content.split("\n")) {
    if (line.startsWith("#") || line.trim().length === 0) continue;
    const [heading, label, source] = line.split("\t");
    if (!heading || !label) continue;
    if (!LABELS.includes(label as HeadingKind)) {
      throw new Error(`Unknown label "${label}" for heading "${heading}"`);
    }
    labeled.push({
      heading,
      label: label as HeadingKind,
      source: source === "disagreement" ? "disagreement" : "random",
    });
  }
  return labeled;
}

function sampleForLabeling(
  headings: HeadingRecord[],
  disagreements: string[],
  sampleSize: number,
  disagreementCap: number,
): Array<{ heading: string; source: "random" | "disagreement" }> {
  const disagreementSet = new Set(disagreements.slice(0, disagreementCap));
  const pool = headings.map((record) => record.heading).filter((h) => !disagreementSet.has(h));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = pool[i];
    const b = pool[j];
    if (a !== undefined && b !== undefined) {
      pool[i] = b;
      pool[j] = a;
    }
  }
  return [
    ...Array.from(disagreementSet, (heading) => ({ heading, source: "disagreement" as const })),
    ...pool.slice(0, sampleSize).map((heading) => ({ heading, source: "random" as const })),
  ];
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

async function corpusFromDocs(dir: string): Promise<Array<{ session_id: string; text: string }>> {
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .sort();
  return Promise.all(
    files.map(async (name) => ({
      session_id: name,
      text: await Bun.file(path.join(dir, name)).text(),
    })),
  );
}

async function corpusFromSessionDb(
  dbPath: string,
  params: { after_date: string; before_date: string; project: string | null },
): Promise<DeliverableRow[]> {
  const sessionId = process.env.CLAUDE_SESSION_ID ?? "anonymous";
  const isolatedPath = path.join(process.env.TMPDIR || "/tmp", `headings-eval-${sessionId}.duckdb`);
  console.error(`Copying session DB to ${isolatedPath}`);
  await Bun.write(isolatedPath, Bun.file(dbPath));

  const db = await openSessionDb(isolatedPath);
  try {
    console.error("Dumping deliverable-prose corpus");
    return await db.runQuery<DeliverableRow>("deliverable-prose", params);
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  const argv = cli({
    name: "headings-eval",
    flags: {
      sessionDb: {
        type: String,
        description: "Path to session DuckDB database file",
      },
      docs: {
        type: String,
        description: "Directory of markdown files to evaluate instead of the session DB",
      },
      since: {
        type: String,
        description: "Lower bound date YYYY-MM-DD (default: 180 days ago)",
      },
      until: {
        type: String,
        description: "Upper bound date YYYY-MM-DD (default: today)",
      },
      project: {
        type: String,
        description: "Project glob filter",
      },
      sample: {
        type: Number,
        description: "Emit a labeling file with N random headings plus all disagreements",
      },
      disagreementCap: {
        type: Number,
        description: "Maximum disagreement headings included in the labeling file",
        default: 200,
      },
      labels: {
        type: String,
        description: "Labeled TSV (heading<TAB>label<TAB>source) to score against",
      },
      out: {
        type: String,
        description: "Output directory for corpus artifacts",
        default: "tmp",
      },
    },
  });

  const today = new Date().toISOString().slice(0, 10);
  const since = argv.flags.since ?? daysAgo(180);
  const until = argv.flags.until ?? today;

  let rows: Array<{ session_id: string; text?: string }>;
  let source: string;
  if (argv.flags.docs) {
    const dir = path.resolve(argv.flags.docs);
    rows = await corpusFromDocs(dir);
    source = dir;
  } else if (argv.flags.sessionDb) {
    rows = await corpusFromSessionDb(path.resolve(argv.flags.sessionDb), {
      after_date: since,
      before_date: until,
      project: argv.flags.project ?? null,
    });
    source = `${since}..${until}`;
  } else {
    console.error("One of --session-db or --docs is required");
    process.exit(1);
  }

  const headings = dedupeHeadings(rows);
  console.error(`${rows.length} corpus rows, ${headings.length} unique headings`);

  mkdirSync(argv.flags.out, { recursive: true });
  const corpusPath = path.join(argv.flags.out, "headings-corpus.tsv");
  await Bun.write(
    corpusPath,
    `# heading\toccurrences\tsessions\n${headings
      .map((record) => `${record.heading}\t${record.occurrences}\t${record.sessions}`)
      .join("\n")}\n`,
  );
  console.error(`Corpus written to ${corpusPath} (local only; never commit or paste)`);

  const evaluation = evaluateClassifiers(headings, CLASSIFIERS);

  console.log(`Headings: ${headings.length} unique (${source})`);
  console.log(
    table([
      ["classifier", "flags", "flag rate", "baseline agreement", "disagreements"],
      ...evaluation.stats.map((row) => [
        row.name,
        String(row.flags),
        percent(row.flagRate),
        percent(row.agreement),
        String(row.disagreements),
      ]),
    ]),
  );

  if (argv.flags.sample !== undefined) {
    const sample = sampleForLabeling(
      headings,
      evaluation.disagreements,
      argv.flags.sample,
      argv.flags.disagreementCap,
    );
    const labelsPath = path.join(argv.flags.out, "heading-labels.tsv");
    await Bun.write(
      labelsPath,
      `# heading\tlabel\tsource\n# label one of: ${LABELS.join(", ")}\n${sample
        .map((row) => `${row.heading}\t\t${row.source}`)
        .join("\n")}\n`,
    );
    console.error(
      `Labeling file written to ${labelsPath}: ${sample.length} rows ` +
        `(${sample.filter((row) => row.source === "disagreement").length} disagreements). ` +
        "Fill the label column; local only.",
    );
  }

  if (argv.flags.labels) {
    const labeled = parseLabelsFile(await Bun.file(argv.flags.labels).text());
    const randomOnly = labeled.filter((row) => row.source === "random");
    console.log(`Labeled: ${labeled.length} rows (${randomOnly.length} random)`);
    for (const [title, subset] of [
      ["all labeled rows", labeled],
      ["random sample only (unbiased)", randomOnly],
    ] as const) {
      if (subset.length === 0) continue;
      const scores = scoreAgainstLabels(subset, CLASSIFIERS);
      console.log(`Precision/recall, ${title}:`);
      console.log(
        table([
          ["classifier", "TP", "FP", "FN", "precision", "95% CI", "recall"],
          ...scores.map((row) => [
            row.name,
            String(row.tp),
            String(row.fp),
            String(row.fn),
            percent(row.precision),
            `${percent(row.precisionLo)}..${percent(row.precisionHi)}`,
            percent(row.recall),
          ]),
        ]),
      );
    }
  }
}

function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

if (import.meta.main) {
  await main();
}
