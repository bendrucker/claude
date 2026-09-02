#!/usr/bin/env bun

import { $ } from "bun";
import { cli, command } from "cleye";
import { z } from "zod";
import type { SortKey } from "../../../detection/rank";
import { workflowJudge } from "../../../judge/adapter";
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

const preflightCmd = command(
  {
    name: "preflight",
    flags: {
      base: {
        type: String,
        description: "Diff scope: comments introduced vs the merge-base with <ref>",
      },
      mr: {
        type: String,
        description: "Diff scope: comments introduced by a GitLab merge request (iid)",
      },
      all: {
        type: Boolean,
        default: false,
        description: "Repo scope: every tracked code file's comments",
      },
      path: { type: [String], description: "Narrow either scope to paths matching these globs" },
      sort: { type: String, default: "score", description: "Rank by lines | chars | score" },
      limit: { type: Number, description: "Keep only the top N ranked comments" },
      shardSize: { type: Number, description: "Comments per judging agent (default 20)" },
      fix: {
        type: Boolean,
        default: false,
        description: "Ask the judge for a suggestion per finding",
      },
    },
  },
  (parsed) =>
    run(async () => {
      const { base, mr, all, path, sort, limit, shardSize, fix } = parsed.flags;
      await preflight(
        { base, mr, all, pathGlobs: path, sort: parseSort(sort), limit, shardSize, fix },
        { io: consoleIo, judge: workflowJudge((line) => consoleIo.log(line)) },
      );
    }),
);

const applyCmd = command(
  {
    name: "apply",
    flags: {
      job: { type: String, description: "The job dir printed by preflight" },
      report: { type: Boolean, default: false, description: "Print findings instead of applying" },
      fix: { type: Boolean, default: false, description: "Include suggestions in the report" },
      format: {
        type: String,
        description:
          "Format each edited file through this shell template ({} = path, content on stdin)",
      },
      maxWidth: {
        type: Number,
        description: "Refuse a splice past this line width (unchecked when omitted)",
      },
    },
  },
  (parsed) =>
    run(async () => {
      const { job, report, fix, format, maxWidth } = parsed.flags;
      if (job == null || job === "") throw new AuditError("--job <dir> is required.");
      await apply({ job, report, fix, format, maxWidth }, consoleIo);
    }),
);

await cli(
  {
    name: "audit",
    commands: [preflightCmd, applyCmd],
  },
  (parsed) => {
    parsed.showHelp();
  },
);
