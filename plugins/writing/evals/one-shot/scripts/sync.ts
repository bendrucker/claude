#!/usr/bin/env bun

import { join } from "node:path";
import { $ } from "bun";

// data/ is gitignored because it holds text mined from sessions, so the
// bucket is its only shared home.

const BUCKET = "s3://ben-drucker-agents-eval-corpus/one-shot/data";
const data = join(import.meta.dirname, "..", "data");

const [direction, ...rest] = Bun.argv.slice(2);
if (direction !== "pull" && direction !== "push") {
  console.error("usage: sync.ts pull|push [--profile <name> | --no-profile] [--dry-run]");
  process.exit(2);
}
const defaultProfile = direction === "pull" ? "agents" : "agents-admin";
const at = rest.indexOf("--profile");
const profile = at === -1 ? defaultProfile : rest[at + 1];
// A cloud session reads its credentials from the environment.
const auth = rest.includes("--no-profile") ? [] : ["--profile", profile];
const dryRun = rest.includes("--dry-run") ? ["--dryrun"] : [];
const [from, to] = direction === "pull" ? [BUCKET, data] : [data, BUCKET];
await $`aws s3 sync ${from} ${to} --exclude ${".*"} ${auth} ${dryRun}`;
