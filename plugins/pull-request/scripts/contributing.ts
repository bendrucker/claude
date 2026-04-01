#!/usr/bin/env bun

import { type ExecSyncOptions, execSync } from "node:child_process";
import { join } from "node:path";

const CANDIDATES = ["CONTRIBUTING.md", "contributing.md", ".github/CONTRIBUTING.md"];

export async function findContributing(repoRoot: string): Promise<{ path: string; content: string } | null> {
  for (const candidate of CANDIDATES) {
    const full = join(repoRoot, candidate);
    const file = Bun.file(full);
    if (await file.exists()) {
      return { path: candidate, content: await file.text() };
    }
  }
  return null;
}

function getRepoRoot(): string {
  const options: ExecSyncOptions = { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] };
  return execSync("git rev-parse --show-toplevel", options).toString().trim();
}

if (import.meta.main) {
  const result = await findContributing(getRepoRoot());
  if (result) {
    console.log(`Contributing Guidelines (${result.path}):\n`);
    console.log(result.content.trim());
  }
}
