#!/usr/bin/env bun

import { join } from "node:path";
import { Command } from "@commander-js/extra-typings";
import { $ } from "bun";

// data/ holds work-host plan text, so the bucket is its permanent home and the
// checkout keeps only a gitignored copy.

const BUCKET = "s3://ben-drucker-agents-eval-corpus/plan-gate/data";
const data = join(import.meta.dirname, "..", "data");

function sync(direction: "pull" | "push", profile: string) {
  return new Command(direction)
    .description(
      direction === "pull"
        ? "Copy the mined presentations and replay baseline from the eval bucket."
        : "Upload the local presentations and replay baseline to the eval bucket.",
    )
    .option("--profile <name>", "AWS profile", profile)
    .option("--dry-run", "print what would change")
    .action(async (options) => {
      const [from, to] = direction === "pull" ? [BUCKET, data] : [data, BUCKET];
      const dryRun = options.dryRun ? ["--dryrun"] : [];
      await $`aws s3 sync ${from} ${to} --exclude ${".*"} --profile ${options.profile} ${dryRun}`;
    });
}

export const program = new Command("sync")
  .description("Mirror the plan gate corpus between this checkout and the eval bucket.")
  .addCommand(sync("pull", "agents"))
  .addCommand(sync("push", "agents-admin"));

if (import.meta.main) {
  await program.parseAsync();
}
