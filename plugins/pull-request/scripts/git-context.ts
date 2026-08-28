#!/usr/bin/env bun

import { type ExecSyncOptions, execSync } from "node:child_process";

const execOptions: ExecSyncOptions = { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] };

function exec(command: string): string {
  return execSync(command, execOptions).toString().trim();
}

function diff(): string {
  try {
    return exec("git diff HEAD");
  } catch {
    try {
      return exec("git diff --cached");
    } catch {
      return "";
    }
  }
}

export function gitContext(): string {
  const branch = exec("git branch --show-current");
  const status = exec("git status --short");
  const log = exec("git log --oneline -20");

  const sections = [`Branch: ${branch}`];

  if (status !== "") {
    sections.push(`Status:\n${status}`);
  }

  if (log !== "") {
    sections.push(`Log:\n${log}`);
  }

  const d = diff();
  if (d !== "") {
    sections.push(`Diff:\n${d}`);
  }

  return sections.join("\n\n");
}

if (import.meta.main) {
  console.log(gitContext());
}
