#!/usr/bin/env bun

import { globSync } from "node:fs";
import { join } from "node:path";
import { Command } from "@commander-js/extra-typings";
import { $ } from "bun";

const BUCKET = "s3://ben-drucker-agents-eval-corpus/pr-body";
const evals = join(import.meta.dirname, "..", "..");
const scenarios = join(evals, "create-scenarios");

/** A local directory mirrored to a bucket prefix, with the `aws s3 sync` filters it needs. */
export interface Mirror {
  local: string;
  remote: string;
  filters: string[];
}

export const mirrors: Mirror[] = [
  { local: join(evals, "pr-body", "fixtures"), remote: `${BUCKET}/fixtures`, filters: [] },
  {
    local: join(evals, "pr-body", "data", "revisions"),
    remote: `${BUCKET}/data/revisions`,
    filters: ["--exclude", ".*"],
  },
  {
    local: scenarios,
    remote: `${BUCKET}/create-scenarios`,
    filters: [
      "--exclude",
      "*",
      "--include",
      "scenario-*",
      "--include",
      "examples/scenario-*",
      "--include",
      "work-*",
      "--include",
      "examples/work-*",
    ],
  },
];

export function syncArgs(
  mirror: Mirror,
  direction: "pull" | "push",
  options: { profile: string; dryRun?: true | undefined },
): string[] {
  const [from, to] =
    direction === "pull" ? [mirror.remote, mirror.local] : [mirror.local, mirror.remote];
  return [
    "s3",
    "sync",
    from,
    to,
    ...mirror.filters,
    "--profile",
    options.profile,
    ...(options.dryRun ? ["--dryrun"] : []),
  ];
}

function sync(direction: "pull" | "push", profile: string) {
  return new Command(direction)
    .description(
      direction === "pull"
        ? "Copy the pr-body fixtures and create-scenarios cases from the eval bucket."
        : "Upload the local pr-body fixtures and create-scenarios cases to the eval bucket.",
    )
    .option("--profile <name>", "AWS profile", profile)
    .option("--dry-run", "print what would change")
    .action(async (options) => {
      await Promise.all(mirrors.map((m) => $`aws ${syncArgs(m, direction, options)}`));
      // S3 drops file modes, and the runner executes each case's scaffold script.
      if (direction === "pull" && !options.dryRun)
        await $`chmod +x ${globSync("*/fixture.sh", { cwd: scenarios })}`.cwd(scenarios);
    });
}

export const program = new Command("sync")
  .description("Mirror the mined pr-body eval data between this checkout and the eval bucket.")
  .addCommand(sync("pull", "agents"))
  .addCommand(sync("push", "agents-admin"));

if (import.meta.main) {
  await program.parseAsync();
}
