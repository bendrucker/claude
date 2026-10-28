#!/usr/bin/env bun
import { mkdir, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { Command, InvalidArgumentError } from "@commander-js/extra-typings";
import { table } from "table";
import { z } from "zod";
import { legacyResults, type ScanResult } from "../../../detection/scan";
import { PATTERNS } from "../../../detection/tropes";
import { CATEGORY_ALIASES, type ValeAlert, valeAlerts } from "../../../detection/vale";
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
const CHUNK_WORDS = 1500;
const CONTEXT_CHARS = 200;

export type Group = keyof typeof groups;

export interface ExampleParity {
  category: string;
  check: string | null;
  positives: { flagged: number; total: number };
  negatives: { flagged: number; total: number };
}

export interface VoiceRate {
  category: string;
  check: string | null;
  legacy: number;
  vale: number;
}

export interface QueueEntry {
  group: Group;
  category: string;
  check: string;
  engine: "legacy" | "vale";
  source: string;
  matched: string;
  context: string;
}

const Report = z.object({
  group: z.string(),
  words: z.number(),
  examples: z.array(
    z.object({
      category: z.string(),
      check: z.string().nullable(),
      positives: z.object({ flagged: z.number(), total: z.number() }),
      negatives: z.object({ flagged: z.number(), total: z.number() }),
    }),
  ),
  voice: z.array(
    z.object({
      category: z.string(),
      check: z.string().nullable(),
      legacy: z.number(),
      vale: z.number(),
    }),
  ),
  queued: z.number(),
});
type Report = z.infer<typeof Report>;

function checkOf(category: string): string | null {
  return CATEGORY_ALIASES[category] ?? null;
}

async function flags(text: string, check: string): Promise<boolean> {
  return (await valeAlerts(text, { kind: "body" })).some((alert) => alert.Check === check);
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
export function sampleChunks(
  files: { name: string; text: string }[],
  budget: number,
): { source: string; text: string }[] {
  const perFile = Math.ceil(budget / Math.max(files.length, 1));
  const chunks: { source: string; text: string }[] = [];
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
  chunk: { source: string; text: string },
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
      category: hit.category,
      check,
      engine: "legacy",
      source: chunk.source,
      matched: hit.matched,
      context: contextAt(chunk.text, hit.line, hit.matched),
    });
  }
  for (const alert of vale) {
    const categories = Object.keys(CATEGORY_ALIASES).filter(
      (category) => CATEGORY_ALIASES[category] === alert.Check,
    );
    if (legacy.some((hit) => categories.includes(hit.category) && hit.line === alert.Line))
      continue;
    entries.push({
      group,
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

export async function runGroup(
  group: Group,
  budget: number,
  voiceDir: string,
  concurrency = 2,
): Promise<Report> {
  const categories = groups[group];
  const categorySet = new Set<string>(categories);
  const checks = new Set(categories.map(checkOf).filter((check) => check !== null));
  const examples = await exampleParity(categories);

  const chunks = sampleChunks(await readVoice(voiceDir), budget);
  const scanned = await mapLimit(chunks, concurrency, async (chunk) => {
    const [legacy, alerts] = await Promise.all([
      legacyResults(chunk.text, categorySet),
      valeAlerts(chunk.text, { kind: "body" }),
    ]);
    return { chunk, legacy, vale: alerts.filter((alert) => checks.has(alert.Check)) };
  });

  const counts = new Map(categories.map((category) => [category, { legacy: 0, vale: 0 }]));
  const queue: QueueEntry[] = [];
  let words = 0;
  for (const { chunk, legacy, vale } of scanned) {
    words += countWords(chunk.text);
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
    queue.push(...disagreements(group, chunk, legacy, vale));
  }

  const per1k = (n: number): number => Math.round((n / Math.max(words, 1)) * 1000 * 1000) / 1000;
  const report: Report = {
    group,
    words,
    examples,
    voice: categories.map((category) => {
      const row = counts.get(category) ?? { legacy: 0, vale: 0 };
      return {
        category,
        check: checkOf(category),
        legacy: per1k(row.legacy),
        vale: per1k(row.vale),
      };
    }),
    queued: queue.length,
  };

  const dir = join(RESULTS, group);
  await mkdir(dir, { recursive: true });
  await Bun.write(join(dir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await Bun.write(
    join(dir, "queue.jsonl"),
    queue.map((entry) => `${JSON.stringify(entry)}\n`).join(""),
  );
  return report;
}

function ratio({ flagged, total }: { flagged: number; total: number }): string {
  return `${flagged}/${total}`;
}

export function formatReport(report: Report): string {
  const rows = report.voice.map((voice) => {
    const example = report.examples.find((row) => row.category === voice.category);
    return [
      voice.category,
      voice.check ?? "(unported)",
      example ? ratio(example.positives) : "",
      example ? ratio(example.negatives) : "",
      String(voice.legacy),
      String(voice.vale),
    ];
  });
  return `${report.group}: ${report.words} voice words, ${report.queued} queued\n${table([["category", "check", "pos hit", "neg hit", "legacy FP/1k", "vale FP/1k"], ...rows])}`;
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

const run = new Command("run")
  .description(
    "Compare a group's TS detectors with their Vale rules on examples and the voice baseline.",
  )
  .requiredOption("--group <group>", "port group from vale-groups.json", groupArg)
  .option("--words <n>", "voice-baseline words to sample", int, 100_000)
  .option("--voice-dir <dir>", "voice baseline directory", VOICE_DIR)
  .option("--concurrency <n>", "vale processes in flight", int, 2)
  .action(async (options) => {
    console.log(
      formatReport(
        await runGroup(options.group, options.words, options.voiceDir, options.concurrency),
      ),
    );
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
  .addCommand(report)
  .addCommand(queue);

if (import.meta.main) await program.parseAsync();
