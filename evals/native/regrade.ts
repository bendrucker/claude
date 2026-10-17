#!/usr/bin/env bun
import { basename, join } from "node:path";
import { Command } from "@commander-js/extra-typings";
import { regrade } from "../../packages/evals/regrade";

function verb(passed: boolean | undefined): string {
  if (passed === undefined) return "dropped";
  return passed ? "now passes" : "now fails";
}

export const program = new Command("regrade.ts")
  .description(
    "Re-grade stored runs against the suite's current regex graders, so a grader fix needs no new sessions. Reads each results directory's traces/ and writes <results>-regraded/ beside it for compare.ts. llm and file-target graders keep their recorded verdicts.",
  )
  .argument("<suite>", "suite directory")
  .argument("<results...>", "results directories")
  .action(async (suite, results) => {
    const outs = results.map((r) => join(r, "..", `${basename(r)}-regraded`));
    const all = await Promise.all(results.map((r, i) => regrade(suite, r, outs[i] ?? "")));
    for (const [i, flips] of all.entries()) {
      for (const f of flips) console.log(`${f.run}: ${f.grader} ${verb(f.passed)}`);
      console.log(`${outs[i]}: ${flips.length} verdicts changed`);
    }
  });

if (import.meta.main) {
  await program.parseAsync();
}
