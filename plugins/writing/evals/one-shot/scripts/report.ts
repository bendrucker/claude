#!/usr/bin/env bun
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { Command } from "@commander-js/extra-typings";
import { table } from "table";
import { z } from "zod";

const Counted = z.object({ Check: z.string() });

const Result = z.object({
  id: z.string(),
  before: z.array(Counted),
  after: z.array(Counted),
  words: z.object({ before: z.number(), after: z.number() }),
  meaning: z.object({ preserved: z.boolean(), lost: z.array(z.string()) }),
});
export type Result = z.infer<typeof Result>;

export interface CheckRow {
  check: string;
  /** Drafts the check fired on before the rewrite. */
  drafts: number;
  before: number;
  /** Instances left in those drafts after the rewrite. */
  residual: number;
  /** Instances in rewrites of drafts where the check did not fire before. */
  introduced: number;
  /** Drafts the check fired on whose rewrite lost meaning. */
  lossy: number;
}

export interface Summary {
  drafts: number;
  clean: number;
  preserved: number;
  wordRatio: number;
  rows: CheckRow[];
}

function tally(findings: { Check: string }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const { Check: check } of findings) counts.set(check, (counts.get(check) ?? 0) + 1);
  return counts;
}

function emptyRow(check: string): CheckRow {
  return { check, drafts: 0, before: 0, residual: 0, introduced: 0, lossy: 0 };
}

export function summarize(results: Result[]): Summary {
  const rows = new Map<string, CheckRow>();
  const row = (check: string) => {
    const existing = rows.get(check) ?? emptyRow(check);
    rows.set(check, existing);
    return existing;
  };
  for (const result of results) {
    const before = tally(result.before);
    const after = tally(result.after);
    for (const [check, count] of before) {
      const entry = row(check);
      entry.drafts += 1;
      entry.before += count;
      entry.residual += after.get(check) ?? 0;
      if (!result.meaning.preserved) entry.lossy += 1;
    }
    for (const [check, count] of after) {
      if (!before.has(check)) row(check).introduced += count;
    }
  }
  const ratios = results.map((result) => result.words.after / Math.max(1, result.words.before));
  return {
    drafts: results.length,
    clean: results.filter((result) => result.after.length === 0).length,
    preserved: results.filter((result) => result.meaning.preserved).length,
    wordRatio: ratios.reduce((sum, ratio) => sum + ratio, 0) / Math.max(1, ratios.length),
    rows: [...rows.values()].toSorted((a, b) =>
      b.drafts === a.drafts ? a.check.localeCompare(b.check) : b.drafts - a.drafts,
    ),
  };
}

const percent = (part: number, whole: number) =>
  whole === 0 ? "-" : `${Math.round((100 * part) / whole)}%`;

const fixRate = (row: CheckRow) => percent(row.before - row.residual, row.before);

function delta(current: string, base: string | undefined): string {
  return base === undefined || base === current ? current : `${current} (was ${base})`;
}

/** Per-check fix, survival, introduction, and meaning-loss figures, with a base run's beside them. */
export function render(summary: Summary, base?: Summary): string {
  const baseRows = new Map(base?.rows.map((row) => [row.check, row]));
  const header = ["check", "drafts", "fixed", "residual", "introduced", "lossy"];
  const body = summary.rows.map((row) => {
    const was = baseRows.get(row.check);
    return [
      row.check,
      String(row.drafts),
      delta(fixRate(row), was && fixRate(was)),
      delta(String(row.residual), was && String(was.residual)),
      delta(String(row.introduced), was && String(was.introduced)),
      delta(percent(row.lossy, row.drafts), was && percent(was.lossy, was.drafts)),
    ];
  });
  const overall = [
    `drafts ${summary.drafts}`,
    `clean ${delta(percent(summary.clean, summary.drafts), base && percent(base.clean, base.drafts))}`,
    `meaning kept ${delta(percent(summary.preserved, summary.drafts), base && percent(base.preserved, base.drafts))}`,
    `words ${delta(summary.wordRatio.toFixed(2), base?.wordRatio.toFixed(2))}x`,
  ].join(", ");
  return `${overall}\n\n${table([header, ...body])}`;
}

const root = join(import.meta.dirname, "..", "results");

async function load(run: string): Promise<Result[]> {
  const dir = join(root, run);
  const names = (await readdir(dir)).filter((name) => name.endsWith(".json"));
  return Promise.all(
    names.map(async (name) => Result.parse(await Bun.file(join(dir, name)).json())),
  );
}

const program = new Command()
  .name("report")
  .description("Per-rule outcomes of a rewrite run, optionally against a base run.")
  .argument("<run>", "run directory under results/")
  .option("--base <run>", "run to compare against, over the drafts both runs share")
  .action(async (run, options) => {
    const current = await load(run);
    if (options.base === undefined) {
      console.log(render(summarize(current)));
      return;
    }
    const base = await load(options.base);
    const shared = new Set(base.map((result) => result.id));
    const both = current.filter((result) => shared.has(result.id));
    const ids = new Set(both.map((result) => result.id));
    console.log(render(summarize(both), summarize(base.filter((result) => ids.has(result.id)))));
  });

if (import.meta.main) await program.parseAsync();
