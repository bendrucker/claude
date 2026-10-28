#!/usr/bin/env bun
import { Command } from "@commander-js/extra-typings";
import { generate } from "../../packages/evals/generate";
import { suiteName } from "../../packages/evals/layout";
import { findResults, latestResult, summarize } from "../../packages/evals/summary";

export const program = new Command("summary.ts")
  .description(
    "Print a JSON summary of a suite's newest run: its suite name, result path, report title, case count, and cost. With --baseline, the title counts the rows compare.ts flags against the runs found under that directory.",
  )
  .argument("<suite>", "suite directory")
  .option("--baseline <dir>", "directory holding baseline runs at any depth")
  .option("--label <label>", "baseline label in the title", "baseline")
  .action(async (suite, options) => {
    const result = latestResult(suite);
    if (result === undefined) {
      program.error(`No results/*/aggregate-result.json in ${suite}`);
      return;
    }
    const baseline = options.baseline === undefined ? undefined : findResults(options.baseline);
    if (baseline?.length === 0) program.error(`No aggregate-result.json under ${options.baseline}`);
    if (baseline !== undefined) await generate(suite);
    const summary = await summarize(result, {
      suite,
      baseline: baseline === undefined ? undefined : { label: options.label, paths: baseline },
    });
    console.log(JSON.stringify({ suite: suiteName(suite), result, baseline, ...summary }));
  });

if (import.meta.main) {
  await program.parseAsync();
}
