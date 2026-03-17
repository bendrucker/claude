#!/usr/bin/env bun

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";
import { merge } from "./merge";

interface StackRef {
  prev: string;
  branch: string;
  sha: string;
  next: string;
  mr: string;
  description: string;
}

async function stackTitle(): Promise<string> {
  const title = await $`git config glab.currentstack`.text();
  return title.trim();
}

async function readStackRefs(title: string): Promise<StackRef[]> {
  const topLevel = (await $`git rev-parse --show-toplevel`.text()).trim();
  const stackDir = join(topLevel, ".git", "stacked", title);
  const entries = await readdir(stackDir);

  const refs = new Map<string, StackRef>();
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const ref: StackRef = await Bun.file(join(stackDir, entry)).json();
    refs.set(ref.sha, ref);
  }

  const first = [...refs.values()].find((r) => r.prev === "");
  if (!first) throw new Error("No first ref found in stack");

  const ordered: StackRef[] = [];
  let current: StackRef | undefined = first;
  while (current) {
    ordered.push(current);
    current = current.next ? refs.get(current.next) : undefined;
  }

  return ordered;
}

interface ApprovalConfig {
  reset_approvals_on_push: boolean;
}

async function checkApprovalSettings(): Promise<void> {
  const config: ApprovalConfig = await $`glab api projects/:id/approvals`.json();

  if (config.reset_approvals_on_push) {
    console.warn("warn: reset_approvals_on_push is enabled.");
    console.warn("The cascade relies on GitLab 16.7+ smart patch-id reset to preserve approvals.");
    console.warn("Avoid squash merge on individual stack MRs — squash changes the patch-id.");
  }
}

await checkApprovalSettings();

const title = await stackTitle();
const refs = await readStackRefs(title);

if (refs.length === 0) {
  console.error("No stack entries found");
  process.exit(1);
}

for (const ref of refs) {
  try {
    await merge(ref.branch, { autoMerge: true });
    console.log(`auto-merge enabled: ${ref.branch}`);
  } catch {
    console.error(`failed: ${ref.branch}`);
  }
}
