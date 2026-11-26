#!/usr/bin/env bun
import { Command, InvalidArgumentError } from "@commander-js/extra-typings";
import { fit, SUMMARY_LIMIT } from "../../packages/evals/fit";

function count(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new InvalidArgumentError("Not a positive integer.");
  return n;
}

export const program = new Command("fit.ts")
  .description(
    "Print a markdown report trimmed to fit a GitHub check-run summary, dropping collapsed sections first and linking to the full report. A report under the limit prints unchanged.",
  )
  .argument("<report>", "markdown report file")
  .requiredOption("--link <url>", "where the full report lives")
  .option("--limit <chars>", "maximum characters", count, SUMMARY_LIMIT)
  .action(async (report, options) => {
    process.stdout.write(fit(await Bun.file(report).text(), options.link, options.limit));
  });

if (import.meta.main) {
  await program.parseAsync();
}
