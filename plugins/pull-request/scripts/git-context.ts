#!/usr/bin/env bun

import { $ } from "bun";

export async function gitContext(): Promise<string> {
  const branch = (await $`git branch --show-current`.text()).trim();
  const status = (await $`git status --short`.text()).trim();
  const log = (await $`git log --oneline -20`.text()).trim();

  let diff: string;
  try {
    diff = (await $`git diff HEAD`.text()).trim();
  } catch {
    diff = (await $`git diff --cached`.text()).trim();
  }

  const sections = [`Branch: ${branch}`];

  if (status) {
    sections.push(`Status:\n${status}`);
  }

  if (log) {
    sections.push(`Log:\n${log}`);
  }

  if (diff) {
    sections.push(`Diff:\n${diff}`);
  }

  return sections.join("\n\n");
}

if (import.meta.main) {
  console.log(await gitContext());
}
