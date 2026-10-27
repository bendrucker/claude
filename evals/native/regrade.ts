#!/usr/bin/env bun
import { Command } from "@commander-js/extra-typings";
import { resolveAdapter } from "../../packages/evals/adapter";
import { generate } from "../../packages/evals/generate";

function verb(passed: boolean | undefined): string {
  if (passed === undefined) return "dropped";
  return passed ? "now passes" : "now fails";
}

export const program = new Command("regrade.ts")
  .description(
    "Re-grade stored runs against the suite's current graders, so a grader fix needs no new sessions. The native adapter re-scores each results directory's traces/ under the current regex graders and writes <results>-regraded/ beside it for compare.ts, and llm and file-target graders keep their recorded verdicts.",
  )
  .argument("<suite>", "suite directory")
  .argument("<results...>", "stored results")
  .option("--adapter <name|path>", "adapter that re-scores each result", "native")
  .action(async (suite, results, options) => {
    await generate(suite);
    const adapter = await resolveAdapter(options.adapter).catch((error: unknown) =>
      program.error(error instanceof Error ? error.message : String(error)),
    );
    const all = await Promise.all(results.map((r) => adapter.rescore(suite, r)));
    for (const { path, flips } of all) {
      for (const f of flips) console.log(`${f.run}: ${f.grader} ${verb(f.passed)}`);
      console.log(`${path}: ${flips.length} verdicts changed`);
    }
  });

if (import.meta.main) {
  await program.parseAsync();
}
