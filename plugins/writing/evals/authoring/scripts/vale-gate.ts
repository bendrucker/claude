#!/usr/bin/env bun
import { mkdir, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { Command, InvalidArgumentError } from "@commander-js/extra-typings";
import { table } from "table";
import { z } from "zod";
import { legacyResults, type ScanResult } from "../../../detection/scan";
import { PATTERNS } from "../../../detection/tropes";
import {
  CATEGORY_ALIASES,
  VALE_CONFIG,
  type ValeAlert,
  type ValeSource,
  valeAlerts,
  valeBinary,
} from "../../../detection/vale";
import { countWords } from "../../../detection/wordlists";
import groups from "../vale-groups.json" with { type: "json" };

const RESULTS = join(import.meta.dirname, "..", "results", "vale-gate");
const VOICE_DIR = join(
  homedir(),
  ".claude",
  "plugins",
  "data",
  "writing-bendrucker",
  "voice-baseline",
);
const DRAFTS_DIR = join(import.meta.dirname, "..", "data", "drafts");
const CHUNK_WORDS = 1500;
const CONTEXT_CHARS = 200;

export type Group = keyof typeof groups;

export interface ExampleParity {
  category: string;
  check: string | null;
  positives: { flagged: number; total: number };
  negatives: { flagged: number; total: number };
}

export type Corpus = "voice" | "drafts";

export interface Unit {
  source: string;
  text: string;
}

export interface QueueEntry {
  group: Group;
  corpus: Corpus;
  category: string;
  check: string;
  engine: "legacy" | "vale";
  source: string;
  matched: string;
  context: string;
}

const Rate = z.object({ legacy: z.number(), vale: z.number() });

const Report = z.object({
  group: z.string(),
  words: z.object({ voice: z.number(), drafts: z.number() }),
  examples: z.array(
    z.object({
      category: z.string(),
      check: z.string().nullable(),
      positives: z.object({ flagged: z.number(), total: z.number() }),
      negatives: z.object({ flagged: z.number(), total: z.number() }),
    }),
  ),
  rates: z.array(
    z.object({
      category: z.string(),
      check: z.string().nullable(),
      voice: Rate,
      drafts: Rate,
    }),
  ),
  queued: z.number(),
});
type Report = z.infer<typeof Report>;

let aliases: Readonly<Record<string, string>> = CATEGORY_ALIASES;

function checkOf(category: string): string | null {
  return aliases[category] ?? null;
}

export let skippedUnits = 0;

// A unit opening with a `---` line parses as front matter and fails without
// naming a rule file. A broken rule names its file and still throws.
async function lintAs(text: string, source: ValeSource): Promise<ValeAlert[]> {
  try {
    return await valeAlerts(text, source, { strict: true });
  } catch (error) {
    if (error instanceof Error && error.message.includes('"Path": ""')) {
      skippedUnits++;
      return [];
    }
    throw error;
  }
}

// Each check is read under the config section the hook would apply: a
// message-only category's check from a message body, every other from a file.
async function lint(text: string): Promise<ValeAlert[]> {
  const messageChecks = new Set(
    PATTERNS.filter((pattern) => pattern.sideEffectOnly).map((pattern) =>
      checkOf(pattern.category),
    ),
  );
  const [file, body] = await Promise.all([
    lintAs(text, { filePath: "/nonexistent/unit.md" }),
    lintAs(text, { kind: "body" }),
  ]);
  return [
    ...file.filter((alert) => !messageChecks.has(alert.Check)),
    ...body.filter((alert) => messageChecks.has(alert.Check)),
  ];
}

async function flags(text: string, check: string): Promise<boolean> {
  return (await lint(text)).some((alert) => alert.Check === check);
}

export function exampleParity(categories: readonly string[]): Promise<ExampleParity[]> {
  const defs = PATTERNS.filter((pattern) => categories.includes(pattern.category));
  return Promise.all(
    defs.map(async (def) => {
      const check = checkOf(def.category);
      const count = async (texts: string[]): Promise<number> =>
        check === null
          ? 0
          : (await Promise.all(texts.map((text) => flags(text, check)))).filter(Boolean).length;
      const [positives, negatives] = await Promise.all([
        count(def.positives),
        count(def.negatives),
      ]);
      return {
        category: def.category,
        check,
        positives: { flagged: positives, total: def.positives.length },
        negatives: { flagged: negatives, total: def.negatives.length },
      };
    }),
  );
}

/** `fn` over `items` with at most `limit` in flight, results in input order. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    const index = next++;
    const item = items[index];
    if (item === undefined) return;
    results[index] = await fn(item);
    return worker();
  };
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

/** Paragraph-aligned chunks of each file, up to `budget` words split evenly across files. */
export function sampleChunks(files: { name: string; text: string }[], budget: number): Unit[] {
  const perFile = Math.ceil(budget / Math.max(files.length, 1));
  const chunks: Unit[] = [];
  for (const { name, text } of files) {
    let taken = 0;
    let current: string[] = [];
    let currentWords = 0;
    for (const paragraph of text.split(/\n\s*\n/)) {
      if (taken >= perFile) break;
      const words = countWords(paragraph);
      current.push(paragraph);
      currentWords += words;
      taken += words;
      if (currentWords >= CHUNK_WORDS) {
        chunks.push({ source: name, text: current.join("\n\n") });
        current = [];
        currentWords = 0;
      }
    }
    if (current.length > 0) chunks.push({ source: name, text: current.join("\n\n") });
  }
  return chunks;
}

function contextAt(text: string, line: number, matched: string): string {
  const lineText = text.split("\n")[line - 1] ?? "";
  const at = Math.max(lineText.toLowerCase().indexOf(matched.toLowerCase()), 0);
  return lineText.slice(Math.max(at - CONTEXT_CHARS, 0), at + matched.length + CONTEXT_CHARS);
}

export function disagreements(
  group: Group,
  corpus: Corpus,
  chunk: Unit,
  legacy: ScanResult[],
  vale: ValeAlert[],
): QueueEntry[] {
  const entries: QueueEntry[] = [];
  for (const hit of legacy) {
    const check = checkOf(hit.category);
    if (check === null || vale.some((alert) => alert.Check === check && alert.Line === hit.line))
      continue;
    entries.push({
      group,
      corpus,
      category: hit.category,
      check,
      engine: "legacy",
      source: chunk.source,
      matched: hit.matched,
      context: contextAt(chunk.text, hit.line, hit.matched),
    });
  }
  for (const alert of vale) {
    const categories = Object.keys(aliases).filter((category) => aliases[category] === alert.Check);
    if (legacy.some((hit) => categories.includes(hit.category) && hit.line === alert.Line))
      continue;
    entries.push({
      group,
      corpus,
      category: categories[0] ?? "",
      check: alert.Check,
      engine: "vale",
      source: chunk.source,
      matched: alert.Match,
      context: contextAt(chunk.text, alert.Line, alert.Match),
    });
  }
  return entries;
}

async function readVoice(dir: string): Promise<{ name: string; text: string }[]> {
  const names = (await readdir(dir))
    .filter((name) => name.endsWith(".txt"))
    .toSorted((a, b) => a.localeCompare(b));
  return Promise.all(
    names.map(async (name) => ({
      name: basename(name, ".txt"),
      text: await Bun.file(join(dir, name)).text(),
    })),
  );
}

const DraftLine = z.object({
  text: z.string().optional(),
  body: z.string().optional(),
  side: z.string().optional(),
});

/** Model-written drafts from the eval bucket, one file per harness. The rewritten side of a pair is skipped. */
async function readDrafts(dir: string): Promise<{ name: string; text: string }[]> {
  const names = (await readdir(dir).catch(() => []))
    .filter((name) => name.endsWith(".jsonl"))
    .toSorted((a, b) => a.localeCompare(b));
  return Promise.all(
    names.map(async (name) => {
      const lines = (await Bun.file(join(dir, name)).text()).split("\n").filter((l) => l !== "");
      const texts = lines
        .map((line) => DraftLine.parse(JSON.parse(line)))
        .filter((draft) => draft.side !== "after")
        .map((draft) => draft.text ?? draft.body ?? "");
      return { name: basename(name, ".jsonl"), text: texts.join("\n\n") };
    }),
  );
}

interface CorpusScan {
  words: number;
  counts: Map<string, { legacy: number; vale: number }>;
  queue: QueueEntry[];
}

async function scanCorpus(
  group: Group,
  corpus: Corpus,
  units: Unit[],
  concurrency: number,
): Promise<CorpusScan> {
  const categories = groups[group];
  const categorySet = new Set<string>(categories);
  const checks = new Set(categories.map(checkOf).filter((check) => check !== null));
  const scanned = await mapLimit(units, concurrency, async (unit) => {
    const [legacy, alerts] = await Promise.all([
      legacyResults(unit.text, categorySet),
      lint(unit.text),
    ]);
    return { unit, legacy, vale: alerts.filter((alert) => checks.has(alert.Check)) };
  });

  const counts = new Map(categories.map((category) => [category, { legacy: 0, vale: 0 }]));
  const queue: QueueEntry[] = [];
  let words = 0;
  for (const { unit, legacy, vale } of scanned) {
    words += countWords(unit.text);
    for (const hit of legacy) {
      const row = counts.get(hit.category);
      if (row) row.legacy++;
    }
    for (const alert of vale) {
      for (const category of categories) {
        const row = counts.get(category);
        if (row && checkOf(category) === alert.Check) row.vale++;
      }
    }
    queue.push(...disagreements(group, corpus, unit, legacy, vale));
  }
  return { words, counts, queue };
}

function per1k(n: number, words: number): number {
  return Math.round((n / Math.max(words, 1)) * 1000 * 1000) / 1000;
}

export async function runGroup(
  group: Group,
  budget: number,
  voiceDir: string,
  draftsDir: string,
  concurrency = 2,
  draftBudget = Number.POSITIVE_INFINITY,
): Promise<Report> {
  const categories = groups[group];
  const examples = await exampleParity(categories);
  const voice = await scanCorpus(
    group,
    "voice",
    sampleChunks(await readVoice(voiceDir), budget),
    concurrency,
  );
  const drafts = await scanCorpus(
    group,
    "drafts",
    sampleChunks(await readDrafts(draftsDir), draftBudget),
    concurrency,
  );

  const rate = (scan: CorpusScan, category: string): { legacy: number; vale: number } => {
    const row = scan.counts.get(category) ?? { legacy: 0, vale: 0 };
    return { legacy: per1k(row.legacy, scan.words), vale: per1k(row.vale, scan.words) };
  };
  const report: Report = {
    group,
    words: { voice: voice.words, drafts: drafts.words },
    examples,
    rates: categories.map((category) => ({
      category,
      check: checkOf(category),
      voice: rate(voice, category),
      drafts: rate(drafts, category),
    })),
    queued: voice.queue.length + drafts.queue.length,
  };

  const dir = join(RESULTS, group);
  await mkdir(dir, { recursive: true });
  await Bun.write(join(dir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await Bun.write(
    join(dir, "queue.jsonl"),
    [...voice.queue, ...drafts.queue].map((entry) => `${JSON.stringify(entry)}\n`).join(""),
  );
  return report;
}

export type Level = "NO" | "warning" | "error";

export interface SweepRow {
  check: string;
  voice: number;
  drafts: number;
  lift: number;
  level: Level;
}

/** How much more often a check fires on drafts than on the voice baseline, with add-half smoothing. */
export function lift(
  draftHits: number,
  draftWords: number,
  voiceHits: number,
  voiceWords: number,
): number {
  return (
    (draftHits + 0.5) / Math.max(draftWords, 1) / ((voiceHits + 0.5) / Math.max(voiceWords, 1))
  );
}

// Fewer combined hits than this is too little evidence to turn a rule off.
const MIN_SUPPORT = 10;

export function levelFor(liftValue: number, voicePer1k: number, support: number): Level {
  if (support < MIN_SUPPORT) return "warning";
  if (liftValue < 2) return "NO";
  if (liftValue >= 5 && voicePer1k < 0.1) return "error";
  return "warning";
}

async function tallyChecks(
  units: Unit[],
  concurrency: number,
): Promise<{ words: number; hits: Map<string, number> }> {
  const alerts = await mapLimit(units, concurrency, (unit) => lint(unit.text));
  const hits = new Map<string, number>();
  for (const alert of alerts.flat()) hits.set(alert.Check, (hits.get(alert.Check) ?? 0) + 1);
  return { words: units.reduce((sum, unit) => sum + countWords(unit.text), 0), hits };
}

const LsConfig = z.object({ Paths: z.array(z.string()) });

/** Every ai-tells rule on Vale's style paths, so a rule silent in both corpora still gets a level. */
async function aiTellsChecks(): Promise<string[]> {
  const proc = Bun.spawn([valeBinary() ?? "vale", "ls-config", `--config=${VALE_CONFIG}`], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const { Paths } = LsConfig.parse(JSON.parse(await new Response(proc.stdout).text()));
  const files = await Promise.all(
    Paths.map((path) => readdir(join(path, "ai-tells")).catch(() => [])),
  );
  return files
    .flat()
    .filter((name) => name.endsWith(".yml"))
    .map((name) => `ai-tells.${basename(name, ".yml")}`);
}

export async function sweep(
  budget: number,
  voiceDir: string,
  draftsDir: string,
  concurrency = 2,
): Promise<SweepRow[]> {
  const voice = await tallyChecks(sampleChunks(await readVoice(voiceDir), budget), concurrency);
  const drafts = await tallyChecks(
    sampleChunks(await readDrafts(draftsDir), Number.POSITIVE_INFINITY),
    concurrency,
  );
  const checks = new Set([...voice.hits.keys(), ...drafts.hits.keys(), ...(await aiTellsChecks())]);
  return [...checks]
    .map((check) => {
      const voiceHits = voice.hits.get(check) ?? 0;
      const draftHits = drafts.hits.get(check) ?? 0;
      const liftValue = lift(draftHits, drafts.words, voiceHits, voice.words);
      const voicePer1k = per1k(voiceHits, voice.words);
      return {
        check,
        voice: voicePer1k,
        drafts: per1k(draftHits, drafts.words),
        lift: Math.round(liftValue * 100) / 100,
        level: levelFor(liftValue, voicePer1k, voiceHits + draftHits),
      };
    })
    .toSorted((a, b) => b.lift - a.lift);
}

/** `.vale.ini` lines for each ai-tells check whose proposed level differs from its shipped error. */
export function levelLines(rows: SweepRow[]): string[] {
  return rows
    .filter((row) => row.check.startsWith("ai-tells.") && row.level !== "error")
    .map((row) => `${row.check} = ${row.level}`);
}

function ratio({ flagged, total }: { flagged: number; total: number }): string {
  return `${flagged}/${total}`;
}

export function formatReport(report: Report): string {
  const rows = report.rates.map((rate) => {
    const example = report.examples.find((row) => row.category === rate.category);
    return [
      rate.category,
      rate.check ?? "(unported)",
      example ? ratio(example.positives) : "",
      example ? ratio(example.negatives) : "",
      `${rate.voice.legacy} / ${rate.voice.vale}`,
      `${rate.drafts.legacy} / ${rate.drafts.vale}`,
    ];
  });
  const header = [
    "category",
    "check",
    "pos hit",
    "neg hit",
    "voice/1k old/vale",
    "drafts/1k old/vale",
  ];
  return `${report.group}: ${report.words.voice} voice words, ${report.words.drafts} draft words, ${report.queued} queued\n${table([header, ...rows])}`;
}

function int(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new InvalidArgumentError("Not a positive integer.");
  return n;
}

function isGroup(value: string): value is Group {
  return Object.hasOwn(groups, value);
}

function groupArg(value: string): Group {
  if (!isGroup(value))
    throw new InvalidArgumentError(`Expected one of ${Object.keys(groups).join(", ")}.`);
  return value;
}

const AliasOverlay = z.record(z.string(), z.string());

function aliasArg(value: string): Record<string, string> {
  const parsed = AliasOverlay.safeParse(JSON.parse(value));
  if (!parsed.success)
    throw new InvalidArgumentError("Expected a JSON object of category to check.");
  return parsed.data;
}

const run = new Command("run")
  .description(
    "Compare a group's TS detectors with their Vale rules on examples and the voice baseline.",
  )
  .requiredOption("--group <group>", "port group from vale-groups.json", groupArg)
  .option("--words <n>", "voice-baseline words to sample", int, 100_000)
  .option("--voice-dir <dir>", "voice baseline directory", VOICE_DIR)
  .option("--drafts-dir <dir>", "model drafts directory (jsonl)", DRAFTS_DIR)
  .option("--concurrency <n>", "vale processes in flight", int, 2)
  .option("--draft-words <n>", "model-draft words to sample (default: all)", int)
  .option(
    "--aliases <json>",
    "category-to-check entries to apply over category-aliases.json",
    aliasArg,
  )
  .action(async (options) => {
    aliases = { ...CATEGORY_ALIASES, ...options.aliases };
    console.log(
      formatReport(
        await runGroup(
          options.group,
          options.words,
          options.voiceDir,
          options.draftsDir,
          options.concurrency,
          options.draftWords,
        ),
      ),
    );
    if (skippedUnits > 0)
      console.log(`${skippedUnits} units skipped: vale read them as front matter`);
  });

const sweepCommand = new Command("sweep")
  .description(
    "Propose a level for every Vale check from its lift on model drafts over the voice baseline.",
  )
  .option("--words <n>", "voice-baseline words to sample", int, 100_000)
  .option("--voice-dir <dir>", "voice baseline directory", VOICE_DIR)
  .option("--drafts-dir <dir>", "model drafts directory (jsonl)", DRAFTS_DIR)
  .option("--concurrency <n>", "vale processes in flight", int, 2)
  .action(async (options) => {
    const rows = await sweep(
      options.words,
      options.voiceDir,
      options.draftsDir,
      options.concurrency,
    );
    await mkdir(RESULTS, { recursive: true });
    await Bun.write(join(RESULTS, "sweep.json"), `${JSON.stringify(rows, null, 2)}\n`);
    await Bun.write(join(RESULTS, "levels.ini"), `${levelLines(rows).join("\n")}\n`);
    const body = rows.map((row) => [
      row.check,
      String(row.voice),
      String(row.drafts),
      String(row.lift),
      row.level,
    ]);
    console.log(table([["check", "voice/1k", "drafts/1k", "lift", "level"], ...body]));
  });

const report = new Command("report")
  .description("Print every group's last report.")
  .action(async () => {
    const names = (await readdir(RESULTS).catch(() => [])).toSorted((a, b) => a.localeCompare(b));
    const reports = await Promise.all(
      names.map(async (name) => {
        const file = Bun.file(join(RESULTS, name, "report.json"));
        return (await file.exists()) ? Report.parse(await file.json()) : null;
      }),
    );
    for (const found of reports) if (found !== null) console.log(formatReport(found));
  });

const QueueLine = z.object({
  category: z.string(),
  check: z.string(),
  engine: z.enum(["legacy", "vale"]),
});

const queue = new Command("queue")
  .description("Summarize a group's one-engine-only hits.")
  .requiredOption("--group <group>", "port group from vale-groups.json", groupArg)
  .action(async (options) => {
    const text = await Bun.file(join(RESULTS, options.group, "queue.jsonl")).text();
    const tally = new Map<string, string[]>();
    for (const line of text.split("\n").filter((l) => l !== "")) {
      const { category, check, engine } = QueueLine.parse(JSON.parse(line));
      const key = `${category}\t${check}\t${engine}`;
      const row = tally.get(key) ?? [category, check, engine, "0"];
      row[3] = String(Number(row[3]) + 1);
      tally.set(key, row);
    }
    const rows = [...tally.values()];
    console.log(table([["category", "check", "only in", "hits"], ...rows]));
  });

export const program = new Command("vale-gate.ts")
  .addCommand(run)
  .addCommand(sweepCommand)
  .addCommand(report)
  .addCommand(queue);

if (import.meta.main) await program.parseAsync();
