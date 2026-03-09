#!/usr/bin/env bun

import { type ExecSyncOptions, execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const CANDIDATES = ["CONTRIBUTING.md", "contributing.md", ".github/CONTRIBUTING.md"];

export function findContributing(repoRoot: string): { path: string; content: string } | null {
  for (const candidate of CANDIDATES) {
    const full = join(repoRoot, candidate);
    if (existsSync(full)) {
      return { path: candidate, content: readFileSync(full, "utf-8") };
    }
  }
  return null;
}

function getRepoRoot(): string {
  const options: ExecSyncOptions = { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] };
  return execSync("git rev-parse --show-toplevel", options).toString().trim();
}

if (import.meta.main) {
  const result = findContributing(getRepoRoot());
  if (result) {
    console.log(`Contributing Guidelines (${result.path}):\n`);
    console.log(result.content.trim());
  }
}
