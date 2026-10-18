#!/usr/bin/env bun
import { Command } from "@commander-js/extra-typings";
import { wrap } from "../../packages/evals/wrap";

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

export const program = new Command("wrap.ts")
  .description(
    "Wrap skills, agents, and context documents that are not a plugin into a throwaway plugin, so claude plugin eval can load them from any git ref and ablate them.",
  )
  .requiredOption("--out <dir>", "directory to write the plugin to (replaced)")
  .option("--ref <ref>", "git ref to read at; the working tree when absent")
  .option("--repo <dir>", "repository to read from", ".")
  .option("--name <name>", "plugin name, the skill namespace", "user")
  .option("--skill <dir>", "skill directory to include; repeatable", collect, [])
  .option("--agent <file>", "agent file to include; repeatable", collect, [])
  .option("--context <file>", "document to inject at session start; repeatable", collect, [])
  .option("--evals <dir>", "suite directory to copy to evals/")
  .action(async (options) => {
    const path = await wrap({
      repo: options.repo,
      ref: options.ref,
      out: options.out,
      name: options.name,
      skills: options.skill,
      agents: options.agent,
      context: options.context,
      evals: options.evals,
    });
    console.log(path);
  });

if (import.meta.main) {
  await program.parseAsync();
}
