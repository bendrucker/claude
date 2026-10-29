import { join } from "node:path";
import { z } from "zod";

export const DATA = join(import.meta.dirname, "data");

export const Hit = z.object({
  plugin: z.string(),
  check: z.string(),
  severity: z.string(),
  message: z.string(),
  file: z.string(),
  line: z.number(),
  span: z.tuple([z.number(), z.number()]),
  match: z.string(),
});
export type Hit = z.infer<typeof Hit>;

export const Corpus = z.enum(["skills", "agent-facing", "all"]);
export type Corpus = z.infer<typeof Corpus>;

export const Sweep = z.object({
  corpus: Corpus,
  rev: z.string(),
  words: z.number(),
  hits: z.array(Hit),
});
export type Sweep = z.infer<typeof Sweep>;

export const Verdict = z.enum(["right", "wrong", "unsure"]);

export const Label = Hit.extend({
  id: z.string(),
  verdict: Verdict,
  note: z.string(),
  pattern: z.string().optional(),
  /** Scores count a model's labels apart from the user's. */
  by: z.enum(["user", "model"]).default("user"),
  ts: z.string(),
});
export type Label = z.infer<typeof Label>;

/** A span the user marked that no shipped rule caught. */
export const Flag = z.object({
  id: z.string(),
  pattern: z.string(),
  file: z.string(),
  line: z.number(),
  span: z.tuple([z.number(), z.number()]),
  match: z.string(),
  note: z.string(),
  ts: z.string(),
});
export type Flag = z.infer<typeof Flag>;

export const Pattern = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  description: z.string(),
  style: z.enum(["Prompting", "Writing"]),
  /** The shipped rule's check name once the pattern is promoted. */
  check: z.string().optional(),
});
export type Pattern = z.infer<typeof Pattern>;

export const Score = z.object({
  pattern: z.string(),
  candidate: z.string(),
  hits: z.number(),
  right: z.number(),
  wrong: z.number(),
  byModel: z.number().default(0),
  low: z.number(),
  high: z.number(),
  recall: z.number(),
  positives: z.number(),
  perThousand: z.number(),
  ts: z.string(),
});
export type Score = z.infer<typeof Score>;

/** A candidate's unlabeled hit, queued so the next sitting judges text the candidate was not written from. */
export const Queued = Hit.extend({ pattern: z.string(), candidate: z.string() });
export type Queued = z.infer<typeof Queued>;

export function hitId(hit: Pick<Hit, "check" | "file" | "line" | "span">): string {
  return `${hit.check}|${hit.file}|${hit.line}|${hit.span[0]}`;
}

export async function readJsonl<T>(schema: z.ZodType<T>, path: string): Promise<T[]> {
  const file = Bun.file(path);
  if (!(await file.exists())) return [];
  return (await file.text())
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => schema.parse(JSON.parse(line)));
}

export async function appendJsonl(path: string, records: readonly unknown[]): Promise<void> {
  if (records.length === 0) return;
  const file = Bun.file(path);
  const before = (await file.exists()) ? await file.text() : "";
  await Bun.write(path, before + records.map((record) => `${JSON.stringify(record)}\n`).join(""));
}

/** The last record per key, since the stores are append-only and a relabel supersedes. */
export function latest<T>(records: readonly T[], key: (record: T) => string): T[] {
  return [...new Map(records.map((record) => [key(record), record])).values()];
}

export interface Store {
  dir: string;
  sweep(): Promise<Sweep | undefined>;
  writeSweep(sweep: Sweep): Promise<void>;
  labels(): Promise<Label[]>;
  flags(): Promise<Flag[]>;
  patterns(): Promise<Pattern[]>;
  scores(): Promise<Score[]>;
  queue(): Promise<Queued[]>;
  addLabels(records: readonly Label[]): Promise<void>;
  addFlags(records: readonly Flag[]): Promise<void>;
  addPatterns(records: readonly Pattern[]): Promise<void>;
  addScores(records: readonly Score[]): Promise<void>;
  enqueue(records: readonly Queued[]): Promise<void>;
}

export function store(dir = DATA): Store {
  const path = (name: string): string => join(dir, name);
  return {
    dir,
    async sweep() {
      const file = Bun.file(path("hits.json"));
      return (await file.exists()) ? Sweep.parse(await file.json()) : undefined;
    },
    async writeSweep(sweep) {
      await Bun.write(path("hits.json"), JSON.stringify(sweep));
    },
    labels: async () => latest(await readJsonl(Label, path("labels.jsonl")), (l) => l.id),
    flags: async () => latest(await readJsonl(Flag, path("flags.jsonl")), (f) => f.id),
    patterns: async () => latest(await readJsonl(Pattern, path("patterns.jsonl")), (p) => p.slug),
    scores: async () =>
      latest(await readJsonl(Score, path("scores.jsonl")), (s) => `${s.pattern}|${s.candidate}`),
    queue: async () => latest(await readJsonl(Queued, path("queue.jsonl")), hitId),
    addLabels: (records) => appendJsonl(path("labels.jsonl"), records),
    addFlags: (records) => appendJsonl(path("flags.jsonl"), records),
    addPatterns: (records) => appendJsonl(path("patterns.jsonl"), records),
    addScores: (records) => appendJsonl(path("scores.jsonl"), records),
    enqueue: (records) => appendJsonl(path("queue.jsonl"), records),
  };
}
