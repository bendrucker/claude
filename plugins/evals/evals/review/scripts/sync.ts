#!/usr/bin/env bun

import { join } from "node:path";
import { Command } from "@commander-js/extra-typings";
import { $ } from "bun";

export const BUCKET = "s3://ben-drucker-agents-eval-corpus/review/seeds";
export const SEEDS = join(import.meta.dirname, "..", "seeds");

export function syncArgs(
  direction: "pull" | "push",
  options: { profile: string; dryRun?: true | undefined },
): string[] {
  const [from, to] = direction === "pull" ? [BUCKET, SEEDS] : [SEEDS, BUCKET];
  return [
    "s3",
    "sync",
    from,
    to,
    "--exclude",
    ".*",
    "--profile",
    options.profile,
    ...(options.dryRun ? ["--dryrun"] : []),
  ];
}

function sync(direction: "pull" | "push", profile: string) {
  return new Command(direction)
    .description(
      direction === "pull"
        ? "Copy the review suite's seeds from the eval bucket."
        : "Upload the local review suite's seeds to the eval bucket.",
    )
    .option("--profile <name>", "AWS profile", profile)
    .option("--dry-run", "print what would change")
    .action(async (options) => {
      await $`aws ${syncArgs(direction, options)}`;
    });
}

export const program = new Command("sync")
  .description("Mirror the review suite's seeds between this checkout and the eval bucket.")
  .addCommand(sync("pull", "agents"))
  .addCommand(sync("push", "agents-admin"));

if (import.meta.main) {
  await program.parseAsync();
}
