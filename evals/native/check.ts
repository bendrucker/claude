#!/usr/bin/env bun
import { Command } from "@commander-js/extra-typings";
import { check } from "../../packages/evals/check";

export const program = new Command("check.ts")
  .description(
    "Fail on a case whose prompt.md is blank or `undefined`, then test a suite's regex graders against the examples in <suite>/examples/<case>/ before spending runs on them: hand-written replies as .md with a frontmatter `fail:` list, and traces as .jsonl with `fail:` in a sibling .yaml. A directory named after an example holds the files its file-target graders read. Every grader an example can reach must pass it unless listed. Also names case graders that shadow one suite.yaml shares in.",
  )
  .argument("<suite>", "suite directory")
  .action(async (suite) => {
    const { mismatches, unchecked, prompts, shadowed } = await check(suite);
    for (const m of mismatches) console.log(`${m.example}: ${m.grader} should ${m.expected}`);
    for (const c of prompts) console.log(`${c}/prompt.md: empty prompt`);
    if (unchecked.length > 0) console.log(`No example reaches: ${unchecked.join(", ")}`);
    if (shadowed.length > 0) console.log(`Case graders shadow suite.yaml: ${shadowed.join(", ")}`);
    if (mismatches.length > 0 || prompts.length > 0) process.exit(1);
    console.log("Every regex grader agrees with its examples.");
  });

if (import.meta.main) {
  await program.parseAsync();
}
