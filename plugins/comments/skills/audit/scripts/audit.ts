#!/usr/bin/env bun

import { $ } from "bun";
import { Command, InvalidArgumentError, Option } from "@commander-js/extra-typings";
import { z } from "zod";
import type { SortKey } from "../../../detection/rank";
import { agentJudge } from "../../../judge/adapter";
import { apply } from "./apply";
import { AuditError, consoleIo } from "./io";
import { preflight } from "./preflight";

const SORT_KEYS = ["lines", "chars", "score"] as const satisfies readonly SortKey[];

function parseSort(value: string): SortKey {
  const parsed = z.enum(SORT_KEYS).safeParse(value);
  if (parsed.success) return parsed.data;
  console.error(
    `Invalid --sort ${JSON.stringify(value)}; expected one of ${SORT_KEYS.join(", ")}.`,
  );
  return process.exit(1);
}

/**
 * Operate from the git repo root so repo-relative paths (from `git diff` and
 * `git ls-files`) resolve for reads, writes, and `git add`, wherever the script
 * was invoked from.
 */
async function chdirToRepoRoot(): Promise<void> {
  const result = await $`git rev-parse --show-toplevel`.quiet().nothrow();
  const root = result.text().trim();
  if (result.exitCode !== 0 || root === "") {
    console.error("Not inside a git repository.");
    process.exit(1);
  }
  process.chdir(root);
}

async function run(task: () => Promise<void>): Promise<void> {
  await chdirToRepoRoot();
  try {
    await task();
  } catch (error) {
    if (!(error instanceof AuditError)) throw error;
    console.error(error.message);
    process.exit(1);
  }
}

function number(value: string): number {
  const n = Number(value);
  if (Number.isNaN(n)) throw new InvalidArgumentError("Not a number.");
  return n;
}

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

const preflightCmd = new Command("preflight")
  .option("--base <ref>", "Diff scope: comments introduced vs the merge-base with <ref>")
  .option("--mr <iid>", "Diff scope: comments introduced by a GitLab merge request (iid)")
  .option("--all", "Repo scope: every tracked code file's comments", false)
  .option("--path <glob>", "Narrow either scope to paths matching these globs", collect, [])
  .option("--sort <key>", "Rank by lines | chars | score", "score")
  .option("--limit <n>", "Keep only the top N ranked comments", number)
  .option("--shard-size <n>", "Comments per judging agent (default 20)", number)
  .option("--fix", "Ask the judge for a suggestion per finding", false)
  // The skill passes its whole argument list here, apply-time flags included, so accept and ignore them.
  .addOption(new Option("--report").hideHelp())
  .addOption(new Option("--format <template>").hideHelp())
  .addOption(new Option("--max-width <n>").hideHelp())
  .action((flags) =>
    run(async () => {
      const { base, mr, all, path, sort, limit, shardSize, fix } = flags;
      await preflight(
        { base, mr, all, pathGlobs: path, sort: parseSort(sort), limit, shardSize, fix },
        {
          io: consoleIo,
          judge: agentJudge((line) => {
            consoleIo.log(line);
          }),
        },
      );
    }),
  );

const applyCmd = new Command("apply")
  .option("--job <dir>", "The job dir printed by preflight")
  .option("--report", "Print findings instead of applying", false)
  .option("--fix", "Include suggestions in the report", false)
  .option(
    "--format <template>",
    "Format each edited file through this shell template ({} = path, content on stdin)",
  )
  .option(
    "--max-width <n>",
    "Refuse a splice past this line width (default: the replaced comment's width, at least 80)",
    number,
  )
  .action((flags) =>
    run(async () => {
      const { job, report, fix, format, maxWidth } = flags;
      if (job == null || job === "") throw new AuditError("--job <dir> is required.");
      await apply({ job, report, fix, format, maxWidth }, consoleIo);
    }),
  );

export const program = new Command("audit")
  .addCommand(preflightCmd)
  .addCommand(applyCmd)
  .action(() => {
    program.help();
  });

if (import.meta.main) {
  await program.parseAsync();
}
