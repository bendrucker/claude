#!/usr/bin/env bun
import { basename } from "node:path";
import { Command, InvalidArgumentError } from "@commander-js/extra-typings";
import { resolveAdapter } from "../../packages/evals/adapter";
import { loadColumn } from "../../packages/evals/column";
import { render } from "../../packages/evals/compare";

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
    "Compare eval results. Each column is one stored run, or several joined by commas whose runs pool into one column. The first column is the baseline, and a lone column reports that run without comparison. Runs are native aggregate-result.json files unless --adapter names another reader.",
  )
  .argument("<columns...>", "comma-joined result paths per column")
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
  .option("--suite <dir>", "suite directory whose case tags roll case scores up by tag")
  .option(
    "--adapter <name|path>",
    "adapter that reads each result path and the suite's tags: a built-in name, or a module whose default or `adapter` export implements Adapter",
    "native",
  )
  .option("--markdown", "print markdown with the starred rows first and the full tables collapsed")
  .action(async (columns, options) => {
    const paths = columns.map((c) => c.split(","));
    const adapter = await resolveAdapter(options.adapter).catch((error: unknown) =>
      program.error(error instanceof Error ? error.message : String(error)),
    );
    const label = adapter.label ?? basename;
    console.log(
      render({
        columns: await Promise.all(paths.map((p) => loadColumn(p, adapter))),
        labels: paths.map((p, i) => options.label[i] ?? label(p[0] ?? "")),
        alpha: options.alpha,
        tags: options.suite === undefined ? undefined : await adapter.tags(options.suite),
        markdown: options.markdown,
      }),
    );
  });

if (import.meta.main) {
  await program.parseAsync();
}
