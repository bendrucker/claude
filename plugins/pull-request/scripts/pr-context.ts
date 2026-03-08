#!/usr/bin/env bun

import { $ } from "bun";
import { detectProvider } from "./detect-provider";

const identifier = process.argv[2];
if (!identifier) {
  console.error("Usage: pr-context.ts <pr-number-or-branch>");
  process.exit(1);
}

const provider = detectProvider();

switch (provider) {
  case "github": {
    const pr = (
      await $`gh pr view ${identifier} --json title,body,updatedAt,commits`.text()
    ).trim();
    const diff = (await $`gh pr diff ${identifier}`.text()).trim();
    console.log(`PR:\n${pr}\n\nDiff:\n${diff}`);
    break;
  }
  case "gitlab": {
    const mr = (await $`glab mr view ${identifier}`.text()).trim();
    const diff = (await $`glab mr diff ${identifier}`.text()).trim();
    console.log(`MR:\n${mr}\n\nDiff:\n${diff}`);
    break;
  }
  default:
    console.error(`Unknown provider: ${provider}`);
    process.exit(1);
}
