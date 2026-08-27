#!/usr/bin/env bun

import { $ } from "bun";

type Operation = "rebase" | "merge" | "cherry-pick" | null;

async function detectOperation(): Promise<{ op: Operation; ref: string | null }> {
  const checks: Array<{ op: Operation; ref: string }> = [
    { op: "rebase", ref: "REBASE_HEAD" },
    { op: "merge", ref: "MERGE_HEAD" },
    { op: "cherry-pick", ref: "CHERRY_PICK_HEAD" },
  ];

  for (const { op, ref } of checks) {
    // oxlint-disable-next-line no-await-in-loop -- first match wins: a later ref must not be probed once an earlier one verified.
    const result = await $`git rev-parse --verify ${ref}`.quiet().nothrow();
    if (result.exitCode === 0) {
      return { op, ref };
    }
  }

  return { op: null, ref: null };
}

const { op, ref } = await detectOperation();

if (op == null || ref == null || ref === "") {
  console.log("No conflict operation in progress");
  process.exit(0);
}

console.log(`Operation: ${op}`);
console.log("");

const conflictedFiles = await $`git diff --name-only --diff-filter=U`.text();
if (conflictedFiles.trim() === "") {
  console.log("No conflicted files");
  process.exit(0);
}

console.log("Incoming commits:");
const files = conflictedFiles.trim().split("\n");
const logs = await $`git log --oneline ${ref} -10 -- ${files}`.text();
const trimmedLogs = logs.trim();
console.log(trimmedLogs !== "" ? trimmedLogs : "(none found)");
