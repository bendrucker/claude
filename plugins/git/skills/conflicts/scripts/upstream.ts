#!/usr/bin/env bun

import { $ } from "bun";
import { getDefaultBranch } from "../../../scripts/default-branch";

const defaultBranch = await getDefaultBranch();
if (defaultBranch == null || defaultBranch === "") {
  console.log("Could not determine default branch");
  process.exit(0);
}

const remote = `origin/${defaultBranch}`;

await $`git fetch origin ${defaultBranch}`.quiet().nothrow();

const mergeBase = (await $`git merge-base HEAD ${remote}`.quiet().nothrow()).text().trim();
const upstreamTip = (await $`git rev-parse ${remote}`.quiet().nothrow()).text().trim();

if (mergeBase === "" || upstreamTip === "") {
  console.log("Could not determine divergence");
  process.exit(0);
}

if (mergeBase === upstreamTip) {
  console.log("Branch is up to date with", remote);
  process.exit(0);
}

const commitsBehind = (await $`git rev-list --count ${mergeBase}..${remote}`.quiet().nothrow())
  .text()
  .trim();

console.log(`Default branch: ${defaultBranch}`);
console.log(`Commits behind ${remote}: ${commitsBehind}`);

const ourFiles = (await $`git diff --name-only ${mergeBase}..HEAD`.quiet().nothrow()).text().trim();
const theirFiles = (await $`git diff --name-only ${mergeBase}..${remote}`.quiet().nothrow())
  .text()
  .trim();

const ours = new Set(ourFiles.split("\n").filter(Boolean));
const theirs = new Set(theirFiles.split("\n").filter(Boolean));
const overlapping = [...ours].filter((f) => theirs.has(f));

if (overlapping.length > 0) {
  console.log(`\nFiles modified on both sides (${overlapping.length}):`);
  for (const file of overlapping) {
    console.log(`- ${file}`);
  }
} else {
  console.log("\nNo overlapping file changes");
}
