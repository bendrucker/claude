#!/usr/bin/env bun
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { Command, InvalidArgumentError } from "@commander-js/extra-typings";
import { table } from "table";
import { z } from "zod";
import { lintDirectory, valeBinary } from "../../../detection/vale";

const RESULTS = join(import.meta.dirname, "..", "results", "sweep");
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
const SWEEP_CONFIG = join(import.meta.dirname, "..", "sweep.vale.ini");

interface Unit {
  source: string;
  text: string;
}

function countWords(text: string): number {
  return text.match(/[a-zA-Z]+/g)?.length ?? 0;
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

function per1k(n: number, words: number): number {
  return Math.round((n / Math.max(words, 1)) * 1000 * 1000) / 1000;
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

// Each chunk lints as a message body in one Vale run. A leading `---` would
// parse as front matter and abort the run, so it becomes the equivalent `***` break.
async function tallyChecks(units: Unit[]): Promise<{ words: number; hits: Map<string, number> }> {
  const dir = await mkdtemp(join(tmpdir(), "writing-sweep-"));
  try {
    await Promise.all(
      units.map((unit, index) =>
        Bun.write(join(dir, `${index}.prbody`), unit.text.replace(/^---/, "***")),
      ),
    );
    const hits = new Map<string, number>();
    for (const alert of await lintDirectory(dir, SWEEP_CONFIG)) {
      hits.set(alert.Check, (hits.get(alert.Check) ?? 0) + 1);
    }
    return { words: units.reduce((sum, unit) => sum + countWords(unit.text), 0), hits };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const LsConfig = z.object({ Paths: z.array(z.string()) });

/** Every ai-tells rule on Vale's style paths, so a rule silent in both corpora still gets a level. */
async function aiTellsChecks(): Promise<string[]> {
  const proc = Bun.spawn(
    [valeBinary() ?? "vale", "ls-config", "--no-global", `--config=${SWEEP_CONFIG}`],
    {
      stdout: "pipe",
      stderr: "ignore",
    },
  );
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
): Promise<SweepRow[]> {
  const voice = await tallyChecks(sampleChunks(await readVoice(voiceDir), budget));
  const drafts = await tallyChecks(
    sampleChunks(await readDrafts(draftsDir), Number.POSITIVE_INFINITY),
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

function int(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new InvalidArgumentError("Not a positive integer.");
  return n;
}

export const program = new Command("sweep.ts")
  .description(
    "Propose a level for every Vale check from its lift on model drafts over the voice baseline.",
  )
  .option("--words <n>", "voice-baseline words to sample", int, 100_000)
  .option("--voice-dir <dir>", "voice baseline directory", VOICE_DIR)
  .option("--drafts-dir <dir>", "model drafts directory (jsonl)", DRAFTS_DIR)
  .action(async (options) => {
    const rows = await sweep(options.words, options.voiceDir, options.draftsDir);
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

if (import.meta.main) {
  await program.parseAsync();
}
