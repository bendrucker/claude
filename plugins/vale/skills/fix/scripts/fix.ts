#!/usr/bin/env bun

import { relative } from "node:path";
import { Command, Option } from "@commander-js/extra-typings";
import { table } from "table";
import { apply, Level, type Outcome, preflight } from "./job";

export function report(outcomes: readonly Outcome[], cwd = process.cwd()): string {
  const rows = outcomes.map((outcome) => [
    relative(cwd, outcome.file),
    outcome.before,
    outcome.after,
    outcome.status,
    outcome.added.join("\n"),
  ]);
  const fixed = outcomes.reduce((sum, outcome) => sum + outcome.before - outcome.after, 0);
  return `${table([["file", "before", "after", "status", "added"], ...rows])}${fixed} alert(s) fixed across ${outcomes.length} file(s).\n`;
}

const preflightCommand = new Command("preflight")
  .description("Lint paths with a Vale config and write one rewrite shard per file with alerts.")
  .requiredOption("--config <path>", "the .vale.ini to lint and verify with")
  .addOption(
    new Option("--level <level>", "lowest severity to fix")
      .choices(Level.options)
      .default("warning" as const),
  )
  .option("--model <name>", "model the rewrite agents run on", "sonnet")
  .argument("<paths...>", "files or directories to lint")
  .action(async (paths, options) => {
    const result = await preflight({
      config: options.config,
      paths,
      level: options.level,
      model: options.model,
    });
    console.log(
      `${result.alerts} alert(s) at ${options.level} or above in ${result.files} file(s).`,
    );
    console.log(`<preflight>\n${JSON.stringify(result)}\n</preflight>`);
  });

const applyCommand = new Command("apply")
  .description("Re-lint each rewritten file, restore any that gained an alert, and report.")
  .requiredOption("--job <dir>", "job dir from preflight")
  .action(async (options) => {
    process.stdout.write(report(await apply(options.job)));
  });

export const program = new Command("fix")
  .description("Fix Vale alerts in bulk through a Workflow.")
  .addCommand(preflightCommand)
  .addCommand(applyCommand);

if (import.meta.main) {
  await program.parseAsync();
}
