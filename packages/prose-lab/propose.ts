import { dirname, join } from "node:path";
import { z } from "zod";
import {
  cacheKey,
  promptHash,
  type QueryFn,
  type StructuredOptions,
  structured,
} from "../eval-judge/index";
import type { Hit, Proposed } from "./data";
import { PROPOSED } from "./deck";

export const MODEL = "claude-sonnet-5-5";
/** Lines a quote may sit from the line the model named. */
const DRIFT = 3;
/** A longer file spends more of a call than its cards repay. */
const MAX_CHARS = 40_000;
const CONCURRENCY = 3;

export const Reply = z.object({
  spans: z.array(z.object({ line: z.number().int(), quote: z.string(), reason: z.string() })),
});
export type Reply = z.infer<typeof Reply>;

export const PROMPT = `You are reviewing a markdown document from a repository of Claude Code configuration: skills, rules, READMEs, and CLAUDE.md files. Find the spans whose wording reads as AI-written prose: phrasing a careful human writer would not have chosen, padding, stock rhetorical moves, inflated or figurative vocabulary, formulaic structure.

For each span:
- \`line\` is the line number shown before the text.
- \`quote\` is copied character for character from that one line, as short as the tell allows: a word, phrase, or clause.
- \`reason\` names the pattern in one sentence.

Report prose only. Code, commands, file paths, and quoted examples a document shows on purpose are not spans. Return an empty list when the document reads as written by a person.

Document \`{file}\`:

{text}`;

/** Each quote as a hit on the line nearest the named one that contains it verbatim. */
export function resolve(file: string, lines: readonly string[], reply: Reply): Hit[] {
  return reply.spans.flatMap(({ line, quote, reason }): Hit[] => {
    if (quote.trim() === "") return [];
    const near = lines
      .map((_, i) => i + 1)
      .filter((n) => Math.abs(n - line) <= DRIFT)
      .toSorted((a, b) => Math.abs(a - line) - Math.abs(b - line));
    const found = near.find((n) => lines[n - 1]?.includes(quote) === true);
    if (found === undefined) return [];
    const at = (lines[found - 1] ?? "").indexOf(quote);
    return [
      {
        plugin: "model",
        check: PROPOSED,
        severity: "suggestion",
        message: reason,
        file,
        line: found,
        span: [at + 1, at + quote.length],
        match: quote,
        shipped: false,
      },
    ];
  });
}

/** Up to `count` files taken round-robin across directories. */
export function spread(files: readonly string[], count: number): string[] {
  // A hash order, since sorted names would put every `.claude/` directory ahead of the plugins.
  const groups = [...Map.groupBy(files.toSorted(), (file) => dirname(file))]
    .toSorted(([a], [b]) => Number(Bun.hash(a)) - Number(Bun.hash(b)))
    .map(([, group]) => group);
  const depth = Math.max(0, ...groups.map((group) => group.length));
  return Array.from({ length: depth }, (_, round) =>
    groups.flatMap((group) => group.slice(round, round + 1)),
  )
    .flat()
    .slice(0, count);
}

export interface ProposeOptions {
  files: readonly string[];
  existing: readonly Proposed[];
  root: string;
  model?: string;
  query?: QueryFn;
  onResult?: (result: Proposed) => Promise<void>;
}

interface Job {
  file: string;
  text: string;
  key: string;
}

/** Asks the model for spans in each file whose text or prompt changed since it was last asked. */
export async function propose({
  files,
  existing,
  root,
  model = MODEL,
  query,
  onResult,
}: ProposeOptions): Promise<Proposed[]> {
  const keys = new Map(existing.map((entry) => [entry.file, entry.key]));
  const template = promptHash(PROMPT);
  const jobs = await Promise.all(
    files.map(async (file) => {
      const text = await Bun.file(join(root, file)).text();
      return { file, text, key: cacheKey(template, model, text) };
    }),
  );
  const queue = jobs.filter(
    (job) => job.text.length <= MAX_CHARS && keys.get(job.file) !== job.key,
  );
  const results: Proposed[] = [];

  const ask = async (job: Job): Promise<void> => {
    const lines = job.text.split("\n");
    const numbered = lines.map((line, i) => `${i + 1}\t${line}`).join("\n");
    const prompt = PROMPT.replace("{file}", job.file).replace("{text}", numbered);
    try {
      const options: StructuredOptions = { model, label: `proposer reply for ${job.file}` };
      if (query !== undefined) options.query = query;
      const reply = await structured(Reply, prompt, options);
      const result = {
        file: job.file,
        key: job.key,
        asked: reply.spans.length,
        hits: resolve(job.file, lines, reply),
        ts: new Date().toISOString(),
      };
      results.push(result);
      await onResult?.(result);
    } catch (error) {
      console.error(
        `Skipped ${job.file}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  const worker = async (): Promise<void> => {
    const job = queue.shift();
    if (job === undefined) return;
    await ask(job);
    return worker();
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return results;
}
