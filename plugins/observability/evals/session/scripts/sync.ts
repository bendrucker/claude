#!/usr/bin/env bun

import { join } from "node:path";
import { Command } from "@commander-js/extra-typings";
import { $ } from "bun";

const BUCKET = "s3://ben-drucker-agents-eval-corpus/session";
const evals = join(import.meta.dirname, "..", "..");

/** A local directory mirrored to a bucket prefix, with the `aws s3 sync` filters it needs. */
export interface Mirror {
  local: string;
  remote: string;
  filters: string[];
}

export const mirrors: Mirror[] = [
  {
    local: join(evals, "bench"),
    remote: `${BUCKET}/bench`,
    filters: [
      "--exclude",
      "*",
      "--include",
      "replay.json",
      "--include",
      "snap/*",
      "--include",
      "results/*",
    ],
  },
  {
    // The index stays out: bench.ts build regenerates it from the snapshot.
    local: join(evals, "session"),
    remote: `${BUCKET}/eval`,
    filters: [
      "--exclude",
      "*",
      "--include",
      "data/*",
      "--include",
      "results/*",
      "--exclude",
      "data/*.duckdb*",
    ],
  },
  {
    local: join(evals, "search"),
    remote: `${BUCKET}/search`,
    filters: ["--exclude", "*", "--include", "labels.jsonl"],
  },
];

export function syncArgs(
  mirror: Mirror,
  direction: "pull" | "push",
  options: { profile: string | false; dryRun?: true | undefined },
): string[] {
  const [from, to] =
    direction === "pull" ? [mirror.remote, mirror.local] : [mirror.local, mirror.remote];
  return [
    "s3",
    "sync",
    from,
    to,
    ...mirror.filters,
    ...(options.profile === false ? [] : ["--profile", options.profile]),
    ...(options.dryRun ? ["--dryrun"] : []),
  ];
}

function sync(direction: "pull" | "push", profile: string) {
  return new Command(direction)
    .description(
      direction === "pull"
        ? "Copy the bench replay set, snapshot and results, the eval suite's mined data and runs, and the search labels, from the eval bucket."
        : "Upload the bench and eval suite's mined data and results to the eval bucket.",
    )
    .option("--profile <name>", "AWS profile", profile)
    .option("--no-profile", "use the credentials in the environment")
    .option("--dry-run", "print what would change")
    .action(async (options) => {
      await Promise.all(mirrors.map((m) => $`aws ${syncArgs(m, direction, options)}`));
    });
}

export const program = new Command("sync")
  .description(
    "Mirror the session index's mined bench and eval data between this checkout and the eval bucket.",
  )
  .addCommand(sync("pull", "agents"))
  .addCommand(sync("push", "agents-admin"));

if (import.meta.main) {
  await program.parseAsync();
}
