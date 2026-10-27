#!/usr/bin/env bun
import { mkdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { Command, InvalidArgumentError } from "@commander-js/extra-typings";
import { mapPool } from "../../../../../packages/evals/pool";
import { findAll } from "../../../detection/findings";
import { idOf } from "./mine";
import { type Draft, rewriteDraft, scanOptions } from "./run";

const positive = (value: string) => {
  const parsed = Number.parseInt(value, 10);
  if (!(parsed > 0)) throw new InvalidArgumentError("expected a positive integer");
  return parsed;
};

const program = new Command()
  .name("dogfood")
  .description(
    "Rewrite markdown files against every finding, applying rewrites that keep the meaning.",
  )
  .argument("<globs...>", "markdown files to rewrite, relative to --cwd")
  .requiredOption("--name <name>", "run directory under results/")
  .option("--cwd <dir>", "directory the globs resolve against", process.cwd())
  .option("--apply", "write each rewrite the meaning judge passes back to its file")
  .option("--model <model>", "rewriting model", "claude-sonnet-5-5")
  .option("--judge-model <model>", "meaning judge model", "claude-sonnet-5-5")
  .option("--concurrency <n>", "calls in flight", positive, 3)
  .action(async (globs, options) => {
    const matched = await Promise.all(
      globs.map((pattern) =>
        Array.fromAsync(new Bun.Glob(pattern).scan({ cwd: options.cwd, absolute: true })),
      ),
    );
    const read = await Promise.all(
      [...new Set(matched.flat())].map(async (path): Promise<Draft & { path: string }> => {
        const text = await Bun.file(path).text();
        return { id: idOf(path), split: "dev", message: false, text, path };
      }),
    );
    const flagged = await Promise.all(
      read.map(async (draft) => (await findAll(draft.text, scanOptions(draft))).length > 0),
    );
    const drafts = read.filter((_, index) => flagged[index]);
    const out = join(import.meta.dirname, "..", "results", options.name);
    await mkdir(out, { recursive: true });
    const run = { model: options.model, judgeModel: options.judgeModel };
    const results = await mapPool(drafts, options.concurrency, async (draft) => {
      const result = await rewriteDraft(draft, run);
      const path = relative(options.cwd, draft.path);
      await Bun.write(
        join(out, `${draft.id}.json`),
        `${JSON.stringify({ path, ...result }, null, 2)}\n`,
      );
      if (options.apply === true && result.meaning.preserved)
        await Bun.write(draft.path, result.rewrite);
      return { path, result };
    });
    for (const { path, result } of results) {
      const kept = options.apply === true ? "applied" : "kept";
      const status = result.meaning.preserved ? kept : "lost";
      console.log(`${status}\t${result.before.length} -> ${result.after.length}\t${path}`);
      for (const loss of result.meaning.lost) console.log(`\t- ${loss}`);
    }
  });

if (import.meta.main) await program.parseAsync();
