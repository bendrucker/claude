#!/usr/bin/env bun
import { Command } from "@commander-js/extra-typings";
import { resolveAdapter } from "../../packages/evals/adapter";
import { generate } from "../../packages/evals/generate";
import { strayArgs } from "../../packages/evals/run";

export const program = new Command("run.ts")
  .description(
    "Run an eval suite against the artifacts it tests as they stand at a ref, and print the stored result's path. Arguments after -- pass through to the harness, claude plugin eval for native.",
  )
  .argument("<suite>", "suite directory")
  .argument("[args...]", "arguments for the harness, after --")
  .option("--ref <ref>", "git ref to read the skill or plugin at; the working tree when absent")
  .option("--label <label>", "suffix for the stored result's name")
  .option("--adapter <name|path>", "adapter that runs the suite", "native")
  .action(async (suite, args, options) => {
    await generate(suite);
    const adapter = await resolveAdapter(options.adapter).catch(fail);
    const path = await adapter
      .run(suite, { ref: options.ref, label: options.label, args })
      .catch(fail);
    console.log(path);
  });

function fail(error: unknown): never {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

if (import.meta.main) {
  const stray = strayArgs(process.argv.slice(2));
  if (stray.length > 0) {
    console.error(
      `Unknown arguments before --: ${stray.join(" ")}. Runner arguments go after --, as in: run.ts <suite> -- --case <glob>`,
    );
    process.exit(2);
  }
  await program.parseAsync();
}
