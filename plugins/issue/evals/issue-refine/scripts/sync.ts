#!/usr/bin/env bun

import { join } from "node:path";
import { $ } from "bun";

// results/ is gitignored, so the bucket is the permanent home of every run.

const BUCKET = "s3://ben-drucker-agents-eval-corpus/issue-refine/results";
const results = join(import.meta.dirname, "..", "results");

const [direction, ...rest] = Bun.argv.slice(2);
if (direction !== "pull" && direction !== "push") {
  console.error("usage: sync.ts pull|push [--profile <name> | --no-profile] [--dry-run]");
  process.exit(2);
}
const defaultProfile = direction === "pull" ? "agents" : "agents-admin";
const at = rest.indexOf("--profile");
const profile = at === -1 ? defaultProfile : rest[at + 1];
// A cloud session's credentials come from the environment, not a profile.
const auth = rest.includes("--no-profile") ? [] : ["--profile", profile];
const dryRun = rest.includes("--dry-run") ? ["--dryrun"] : [];
const [from, to] = direction === "pull" ? [BUCKET, results] : [results, BUCKET];
await $`aws s3 sync ${from} ${to} --exclude ${".*"} ${auth} ${dryRun}`;
