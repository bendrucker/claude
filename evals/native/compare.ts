#!/usr/bin/env bun
import { basename, dirname } from "node:path";
import { Command, InvalidArgumentError } from "@commander-js/extra-typings";
import { loadColumn } from "../../packages/evals/column";
import { render } from "../../packages/evals/compare";
import { generate } from "../../packages/evals/generate";
import { loadTags } from "../../packages/evals/suite";

function float(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new InvalidArgumentError("Not a number.");
  return n;
}

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

export const program = new Command("compare.ts")
  .description(
    "Compare native plugin eval results. Each column is one aggregate-result.json, or several joined by commas whose runs pool into one column. The first column is the baseline, and a lone column reports that run without comparison.",
  )
  .argument("<columns...>", "comma-joined aggregate-result.json paths per column")
  .option(
    "--alpha <p>",
    "star a cell whose permutation p-value against the baseline is below this",
    float,
    0.1,
  )
  .option(
    "--label <label>",
    "label for each column in order, defaulting to the first result's directory; repeatable",
    collect,
    [],
  )
  .option("--suite <dir>", "suite directory whose case.yaml tags roll case scores up by tag")
  .option("--markdown", "print markdown with the starred rows first and the full tables collapsed")
  .action(async (columns, options) => {
    if (options.suite !== undefined) await generate(options.suite);
    const paths = columns.map((c) => c.split(","));
    console.log(
      render({
        columns: await Promise.all(paths.map(loadColumn)),
        labels: paths.map((p, i) => options.label[i] ?? basename(dirname(p[0] ?? ""))),
        alpha: options.alpha,
        tags: options.suite === undefined ? undefined : await loadTags(options.suite),
        markdown: options.markdown,
      }),
    );
  });

if (import.meta.main) {
  await program.parseAsync();
}
