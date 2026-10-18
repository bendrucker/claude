#!/usr/bin/env bun
import { dirname, join, relative, resolve } from "node:path";
import { Command } from "@commander-js/extra-typings";
import { $ } from "bun";
import { subscriptionEnv } from "../../packages/eval-judge/env";
import { erroredRuns, readResult } from "../../packages/evals/result";
import {
  collectTraces,
  keepCases,
  pluginErrors,
  prepare,
  splitCases,
  strayArgs,
} from "../../packages/evals/run";
import { readSuite } from "../../packages/evals/suite";

export const program = new Command("run.ts")
  .description(
    "Run a claude plugin eval suite against the artifacts it tests as they stand at a ref. Arguments after -- pass through to claude plugin eval.",
  )
  .argument("<suite>", "suite directory")
  .argument("[args...]", "arguments for claude plugin eval, after --")
  .option("--ref <ref>", "git ref to read the skill or plugin at; the working tree when absent")
  .option("--label <label>", "suffix for the results directory name")
  .action(async (suiteArg, passed, options) => {
    const repo = (await $`git rev-parse --show-toplevel`.text()).trim();
    const suite = relative(repo, resolve(suiteArg));
    const config = await readSuite(join(repo, suite));
    const [globs, args] = splitCases(passed);
    const { target, evalDir } = await prepare(repo, suite, options.ref);
    if (globs.length > 0) await keepCases(join(target, evalDir), globs);
    const stamp = new Date()
      .toISOString()
      .replaceAll(":", "-")
      .replace(/\.\d+Z$/, "Z");
    const label = options.label ?? options.ref?.replaceAll("/", "-");
    const output = join(repo, suite, "results", label === undefined ? stamp : `${stamp}-${label}`);
    const allow = config.allow_tools.length > 0 ? ["--allow-tools", ...config.allow_tools] : [];

    // An API key in the environment would bill the API instead of the subscription.
    const env = subscriptionEnv();
    const proc = Bun.spawn(
      [
        "claude",
        "plugin",
        "eval",
        target,
        "--eval-dir",
        evalDir,
        "--scaffold",
        "--trust-plugin",
        "--judge-model",
        config.judge_model,
        "--output-dir",
        output,
        "--keep-temp",
        ...allow,
        ...args,
      ],
      { env, stdio: ["inherit", "inherit", "inherit"] },
    );
    const code = await proc.exited;
    await collectTraces(output);
    await $`rm -rf ${dirname(target)}`.quiet();
    const loadErrors = await pluginErrors(output);
    if (loadErrors.length > 0) {
      console.error(
        `${loadErrors.length} plugin errors at session start, so those arms ran without the plugin:`,
      );
      for (const e of loadErrors) console.error(`  ${e}`);
      process.exit(1);
    }
    // The runner fails on a run that ended on an API error, which it leaves ungraded. A run it
    // graded despite an error, such as a timeout or a judge call that threw, exits clean.
    const result = join(output, "aggregate-result.json");
    const errors = (await Bun.file(result).exists())
      ? erroredRuns(await readResult(result)).filter((e) => e.graded)
      : [];
    if (errors.length > 0) {
      console.error(`${errors.length} runs errored, and compare.ts leaves them out:`);
      for (const e of errors) console.error(`  ${e.label}`);
      process.exit(1);
    }
    process.exit(code);
  });

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
