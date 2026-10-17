#!/usr/bin/env bun
import { Command } from "@commander-js/extra-typings";
import { table } from "table";
import { tally } from "../../packages/evals/calls";

export const program = new Command("calls.ts")
  .description(
    "Count the runs in each case and arm that made each tool call, pooled across results directories. Shows whether sessions actually read a reference or loaded a skill, which grepping traces for a filename cannot, since injected skill text names files too.",
  )
  .argument("<results...>", "results directories or their aggregate-result.json paths")
  .option("--match <regex>", "only list calls matching this regex, such as 'Read .*references/'")
  .action(async (results, options) => {
    const filter = options.match === undefined ? undefined : new RegExp(options.match);
    const cells = await tally(results);
    const rows = [...cells]
      .toSorted(([a], [b]) => a.localeCompare(b))
      .flatMap(([key, { runs, calls }]) =>
        [...calls]
          .filter(([call]) => filter === undefined || filter.test(call))
          .toSorted(([a], [b]) => a.localeCompare(b))
          .map(([call, n]) => [key, call, `${n}/${runs}`]),
      );
    console.log(
      rows.length > 0 ? table([["case/arm", "call", "runs"], ...rows]) : "No matching calls.",
    );
  });

if (import.meta.main) {
  await program.parseAsync();
}
