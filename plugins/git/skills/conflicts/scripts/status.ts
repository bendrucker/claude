#!/usr/bin/env bun

import { $ } from "bun";

const files = await $`git diff --name-only --diff-filter=U`.text();

if (files.trim() === "") {
  console.log("No conflicted files");
  process.exit(0);
}

for (const file of files.trim().split("\n")) {
  try {
    const content = await Bun.file(file).text();
    const count = (content.match(/^<{7} /gm) || []).length;
    console.log(`- ${file} (${count} conflict${count !== 1 ? "s" : ""})`);
  } catch {
    console.log(`- ${file} (unreadable)`);
  }
}
