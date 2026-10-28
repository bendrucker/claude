#!/usr/bin/env bun
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Command, InvalidArgumentError } from "@commander-js/extra-typings";
import { z } from "zod";
import {
  cacheKey,
  promptHash,
  type QueryFn,
  structured,
} from "../../../../../packages/eval-judge/index";
import { mapPool } from "../../../../../packages/evals/pool";
import { type ScanResult, scanAll } from "../../../detection/scan";

const REWRITE_TEMPLATE = await Bun.file(join(import.meta.dirname, "rewrite-prompt.md")).text();
const MEANING_TEMPLATE = await Bun.file(join(import.meta.dirname, "meaning-prompt.md")).text();

export const Draft = z.object({
  id: z.string(),
  split: z.enum(["dev", "holdout"]),
  message: z.boolean(),
  text: z.string(),
});
export type Draft = z.infer<typeof Draft>;

const Rewrite = z.object({ rewrite: z.string() });
const Meaning = z.object({ preserved: z.boolean(), lost: z.array(z.string()) });

export interface Result {
  id: string;
  key: string;
  model: string;
  split: Draft["split"];
  before: ScanResult[];
  after: ScanResult[];
  words: { before: number; after: number };
  rewrite: string;
  meaning: z.infer<typeof Meaning>;
}

export interface RunOptions {
  model: string;
  judgeModel: string;
  query?: QueryFn;
}

// Every file draft the miner keeps is markdown, so one stand-in path selects
// the same rules the hook applied to it.
export function scanDraft(draft: Pick<Draft, "message">, text: string): Promise<ScanResult[]> {
  return scanAll(text, draft.message ? undefined : "draft.md", { message: draft.message });
}

export function renderFindings(findings: ScanResult[]): string {
  return findings
    .map((finding) => `- line ${finding.line}, ${finding.category}: ${finding.message}`)
    .join("\n");
}

export function fill(template: string, values: Record<string, string>): string {
  return template.replaceAll(/\{\{(\w+)\}\}/g, (match, name: string) => values[name] ?? match);
}

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** The cache key for one draft under the current rules, prompts, and models. */
export function keyOf(draft: Draft, findings: ScanResult[], options: RunOptions): string {
  return cacheKey(
    promptHash(REWRITE_TEMPLATE),
    promptHash(MEANING_TEMPLATE),
    options.model,
    options.judgeModel,
    draft.text,
    renderFindings(findings),
  );
}

export async function rewriteDraft(draft: Draft, options: RunOptions): Promise<Result> {
  const before = await scanDraft(draft, draft.text);
  const call = (model: string, label: string) => ({
    model,
    label,
    ...(options.query && { query: options.query }),
  });
  const { rewrite } = await structured(
    Rewrite,
    fill(REWRITE_TEMPLATE, { findings: renderFindings(before), draft: draft.text }),
    call(options.model, `rewrite of ${draft.id}`),
  );
  const [after, meaning] = await Promise.all([
    scanDraft(draft, rewrite),
    structured(
      Meaning,
      fill(MEANING_TEMPLATE, { original: draft.text, rewrite }),
      call(options.judgeModel, `meaning judge for ${draft.id}`),
    ),
  ]);
  return {
    id: draft.id,
    key: keyOf(draft, before, options),
    model: options.model,
    split: draft.split,
    before,
    after,
    words: { before: words(draft.text), after: words(rewrite) },
    rewrite,
    meaning,
  };
}

const CachedKey = z.object({ key: z.string() });

async function cachedKey(path: string): Promise<string | undefined> {
  const file = Bun.file(path);
  if (!(await file.exists())) return undefined;
  return CachedKey.safeParse(await file.json()).data?.key;
}

const positive = (value: string) => {
  const parsed = Number.parseInt(value, 10);
  if (!(parsed > 0)) throw new InvalidArgumentError("expected a positive integer");
  return parsed;
};

const root = join(import.meta.dirname, "..");

const program = new Command()
  .name("run")
  .description("Rewrite each draft against every finding in one call, then rescan and judge it.")
  .requiredOption("--name <name>", "run directory under results/")
  .option("--drafts <file>", "drafts JSONL", join(root, "data", "drafts.jsonl"))
  .option("--split <split>", "dev or holdout", "dev")
  .option("--limit <n>", "drafts to run", positive)
  .option("--model <model>", "rewriting model", "claude-sonnet-5-5")
  .option("--judge-model <model>", "meaning judge model", "claude-sonnet-5-5")
  .option("--concurrency <n>", "calls in flight", positive, 4)
  .action(async (options) => {
    const lines = (await Bun.file(options.drafts).text()).split("\n").filter(Boolean);
    const drafts = lines
      .map((line) => Draft.parse(JSON.parse(line)))
      .filter((draft) => draft.split === options.split)
      .slice(0, options.limit);
    const out = join(root, "results", options.name);
    await mkdir(out, { recursive: true });
    const run: RunOptions = { model: options.model, judgeModel: options.judgeModel };
    let written = 0;
    await mapPool(drafts, options.concurrency, async (draft) => {
      const path = join(out, `${draft.id}.json`);
      const key = keyOf(draft, await scanDraft(draft, draft.text), run);
      if ((await cachedKey(path)) === key) return;
      await Bun.write(path, `${JSON.stringify(await rewriteDraft(draft, run), null, 2)}\n`);
      written += 1;
      console.error(`${draft.id} (${written})`);
    });
    console.error(`${written} rewritten, ${drafts.length - written} cached, in ${out}`);
  });

if (import.meta.main) await program.parseAsync();
