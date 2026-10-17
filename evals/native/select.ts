#!/usr/bin/env bun
import { Command } from "@commander-js/extra-typings";
import { $ } from "bun";
import { selectSuites } from "../../packages/evals/suite";

export const program = new Command("select.ts")
  .description(
    "Print, as a JSON array, the native suites a change touches: a suite runs when a changed path is inside it, inside a plugin its cases load, or inside an artifact its suite.yaml wraps. A suite holding a .local-only file never runs.",
  )
  .argument("[paths...]", "changed repo-relative paths, read one per line from stdin when absent")
  .action(async (paths) => {
    const repo = (await $`git rev-parse --show-toplevel`.text()).trim();
    const changed = paths.length > 0 ? paths : (await Bun.stdin.text()).split("\n").filter(Boolean);
    console.log(JSON.stringify(await selectSuites(repo, changed)));
  });

if (import.meta.main) {
  await program.parseAsync();
}
