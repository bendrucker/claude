#!/usr/bin/env bun

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";

const root = (await $`git rev-parse --show-toplevel`.text()).trim();

const candidates = ["CONTRIBUTING.md", "contributing.md", ".github/CONTRIBUTING.md"];

for (const candidate of candidates) {
  try {
    const content = await readFile(join(root, candidate), "utf-8");
    console.log(`Contributing Guidelines (${candidate}):\n`);
    console.log(content.trim());
    process.exit(0);
  } catch {
    // not found
  }
}
