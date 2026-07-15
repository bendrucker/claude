#!/usr/bin/env bun

import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { $ } from "bun";
import { cli, command } from "cleye";
import { applyToBranch, isCleanTree } from "../../../apply/branch";
import { computeFileEdits, type EditItem } from "../../../apply/edits";
import { formatContent } from "../../../apply/format";
import { collectVerdicts, matchVerdicts } from "../../../apply/join";
import { color, type ReportItem, renderReport, summarize } from "../../../apply/report";
import {
  type CollectedComment,
  collectDiff,
  collectRepo,
  type MrSource,
  resolveMrSource,
} from "../../../detection/collect";
import type { DiffOptions } from "../../../detection/diff";
import { extractComments, languageForPath } from "../../../detection/extract";
import { rankComments, type SortKey } from "../../../detection/rank";
import type { Comment } from "../../../detection/types";
import { buildJob, type JobShard, writeJob } from "../../../judge/job";
import type { Verdict } from "../../../judge/schema";

const WORKFLOW_PATH = join(import.meta.dirname, "..", "..", "..", "workflow", "judge.workflow.js");

/**
 * Fixed token cost of one judging agent beyond its comment payload: the Claude
 * Code system prompt and tool schemas (~15k), the rubric read (~2.5k), and the
 * multi-turn read/write/output cycle. The preflight estimate is the number the
 * user consents to, so it must include this, not just payload; overhead
 * dominates payload at the default shard size.
 */
const AGENT_OVERHEAD_TOKENS = 25_000;

const SORT_KEYS: SortKey[] = ["lines", "chars", "score"];

function parseSort(value: string): SortKey {
  if ((SORT_KEYS as string[]).includes(value)) return value as SortKey;
  console.error(
    `Invalid --sort ${JSON.stringify(value)}; expected one of ${SORT_KEYS.join(", ")}.`,
  );
  process.exit(1);
}

/**
 * Operate from the git repo root so repo-relative paths (from `git diff` and
 * `git ls-files`) resolve for reads, writes, and `git add`, wherever the script
 * was invoked from.
 */
async function chdirToRepoRoot(): Promise<void> {
  const result = await $`git rev-parse --show-toplevel`.quiet().nothrow();
  const root = result.text().trim();
  if (result.exitCode !== 0 || !root) {
    console.error("Not inside a git repository.");
    process.exit(1);
  }
  process.chdir(root);
}

function preview(text: string): string {
  const firstLine = text.split("\n")[0] ?? "";
  return firstLine.length > 64 ? `${firstLine.slice(0, 61)}...` : firstLine;
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
  async (parsed) => {
    await chdirToRepoRoot();
    const { base, mr, all, path, sort, limit, shardSize, fix } = parsed.flags;
    const pathGlobs = path ?? [];
    const sortKey = parseSort(sort);

    let comments: CollectedComment[];
    if (all) {
      if (!(await isCleanTree())) {
        console.error(
          "Working tree is not clean. --all reads the working tree but applies from HEAD. Commit or stash first.",
        );
        process.exit(1);
      }
      comments = await collectRepo({ pathGlobs });
    } else {
      const options: DiffOptions = {};
      if (base) options.base = base;
      if (mr) options.mr = mr;
      let mrSource: MrSource | null = null;
      if (mr) {
        mrSource = await resolveMrSource(mr);
        if (!mrSource) {
          console.error("Could not resolve the merge request's source ref via glab.");
          process.exit(1);
        }
      }
      comments = await collectDiff(options, mrSource, { pathGlobs });
    }

    const ranked = rankComments(comments, sortKey);
    const limited = typeof limit === "number" ? ranked.slice(0, limit) : ranked;
    if (limited.length === 0) {
      console.log(color.dim("No comments to judge."));
      return;
    }

    const descriptor = await buildJob(limited, { fix, ...(shardSize ? { shardSize } : {}) });
    const written = await writeJob(descriptor);
    // An --mr job records comment text from the remote MR ref, but apply trims
    // the local tree from HEAD. Persist the scope so apply can refuse to branch
    // off a local checkout that would read every comment as drift.
    await Bun.write(join(written.jobDir, "scope.json"), JSON.stringify({ mr: mr ?? null }));

    // Deterministic features per judged comment, keyed by the same id the
    // verdicts use. Each run leaves a (features, verdict) pair in its job dir,
    // the training data for routing obvious comments away from the judge later.
    const features = Object.fromEntries(
      limited.map((c) => [c.id, { path: c.path, startLine: c.startLine, ...c.features }]),
    );
    await Bun.write(join(written.jobDir, "features.json"), JSON.stringify(features, null, 2));

    const fileCount = new Set(limited.map((c) => c.path)).size;
    const payloadTokens = Math.ceil(
      limited.reduce((sum, c) => sum + c.text.length + c.context.length, 0) / 4,
    );
    const tokens = payloadTokens + written.shardCount * AGENT_OVERHEAD_TOKENS;

    console.log(
      color.bold(
        `${limited.length} comments / ${fileCount} files / ~${written.shardCount} agents / ~${tokens} tokens (rough)`,
      ),
    );
    for (const c of limited.slice(0, 10)) {
      console.log(
        `  ${color.dim(String(c.score.score).padStart(5))}  ${c.path}:${c.startLine}  ${preview(c.text)}`,
      );
    }
    console.log("");
    console.log("<preflight>");
    console.log(
      JSON.stringify({
        scriptPath: WORKFLOW_PATH,
        argsPath: written.argsPath,
        jobDir: written.jobDir,
        count: written.count,
        shardCount: written.shardCount,
      }),
    );
    console.log("</preflight>");
  },
);

function toEditItem(comment: Comment, verdict: Verdict): EditItem {
  return {
    startLine: comment.startLine,
    endLine: comment.endLine,
    startColumn: comment.startColumn,
    endColumn: comment.endColumn,
    kind: comment.kind,
    verdict,
  };
}

async function readJsonFiles(dir: string, prefix: string): Promise<unknown[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const matching = names.filter((name) => name.startsWith(prefix) && name.endsWith(".json"));
  return Promise.all(
    matching.map(async (name) => JSON.parse(await Bun.file(join(dir, name)).text())),
  );
}

/** The files a job judged, recovered from the shards. */
async function judgedPaths(jobDir: string): Promise<string[]> {
  const shards = (await readJsonFiles(jobDir, "shard-")) as JobShard[];
  const paths = new Set<string>();
  for (const shard of shards) for (const comment of shard.comments) paths.add(comment.path);
  return [...paths];
}

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
    },
  },
  async (parsed) => {
    await chdirToRepoRoot();
    const { job, report, fix, format } = parsed.flags;
    if (!job) {
      console.error("--job <dir> is required.");
      process.exit(1);
    }

    if (!(await Bun.file(join(job, "job-args.json")).exists())) {
      console.error(`No job at ${job}. Pass the job dir printed by preflight.`);
      process.exit(1);
    }

    const scopeFile = Bun.file(join(job, "scope.json"));
    const scope = (await scopeFile.exists())
      ? (JSON.parse(await scopeFile.text()) as { mr?: string | null })
      : { mr: null };
    if (scope.mr && !report) {
      console.error(
        `This job audited merge request !${scope.mr} from its remote source. Apply writes trims to the local tree from HEAD, so every comment would read as drift. Re-run with --report, or check out the MR branch and re-run preflight with --base.`,
      );
      process.exit(1);
    }

    const verdictShards = await readJsonFiles(join(job, "verdicts"), "verdict-");
    if (verdictShards.length === 0) {
      console.error(`No verdicts in ${join(job, "verdicts")}. Run the judge workflow first.`);
      process.exit(1);
    }
    const verdicts = collectVerdicts(verdictShards);

    const reportItems: ReportItem[] = [];
    const editsByPath = new Map<string, string>();
    const matched = new Set<string>();
    const manualSkips: string[] = [];
    const skippedComments = new Set<string>();
    const editWarnings: { path: string; line: number; detail: string }[] = [];

    // Re-extract each judged file and match verdicts by id at the comment's
    // current range. A verdict whose id no longer re-extracts has drifted.
    for (const path of await judgedPaths(job)) {
      const language = languageForPath(path);
      const file = Bun.file(path);
      if (!language || !(await file.exists())) continue;
      const source = await file.text();
      const editItems: EditItem[] = [];
      for (const match of matchVerdicts(path, await extractComments(source, language), verdicts)) {
        matched.add(match.id);
        reportItems.push({
          path,
          startLine: match.comment.startLine,
          verdict: match.verdict,
          text: match.comment.text,
        });
        if (match.verdict.action !== "keep")
          editItems.push(toEditItem(match.comment, match.verdict));
      }
      if (editItems.length > 0) {
        const result = computeFileEdits(source, editItems);
        for (const skip of result.skips) {
          manualSkips.push(`${path}:${skip.startLine}  ${skip.detail}`);
          skippedComments.add(`${path}:${skip.startLine}`);
        }
        for (const warning of result.warnings)
          editWarnings.push({ path, line: warning.line, detail: warning.detail });
        if (result.content !== source) editsByPath.set(path, result.content);
      }
    }

    const formattedPaths = new Set<string>();
    if (format && !report) {
      for (const [path, content] of editsByPath) {
        const formatted = await formatContent(format, path, content);
        if (formatted.formatted) {
          editsByPath.set(path, formatted.content);
          formattedPaths.add(path);
        } else {
          console.error(
            color.yellow(
              `Formatter failed for ${path} (${formatted.error}); keeping unformatted content.`,
            ),
          );
        }
      }
    }

    const driftSkips = [...verdicts.keys()].filter((id) => !matched.has(id));

    if (report) {
      console.log(renderReport(reportItems, { fix }));
    } else {
      const branch = `comments/audit-${basename(job)}`;
      if (editsByPath.size === 0) {
        console.log(color.dim("Nothing to apply."));
      } else if (!(await isCleanTree())) {
        console.error(
          "Working tree is not clean. Commit or stash before applying, or use --report.",
        );
        process.exit(1);
      } else {
        await applyToBranch(editsByPath, { branch });
        // Count only what landed. Verdicts skipped for manual handling show up
        // in the list below.
        const applied = reportItems.filter(
          (item) => !skippedComments.has(`${item.path}:${item.startLine}`),
        );
        console.log(
          `Applied ${summarize(applied)} on branch ${color.bold(branch)}. Review with git diff HEAD..${branch}.`,
        );
      }
    }

    if (driftSkips.length > 0) {
      console.error(
        color.yellow(
          `Skipped ${driftSkips.length} judged comment(s) no longer found at preflight position (file changed since preflight).`,
        ),
      );
    }
    if (manualSkips.length > 0) {
      console.error(color.yellow(`Left ${manualSkips.length} comment(s) for manual handling:`));
      for (const skip of manualSkips) console.error(`  ${skip}`);
    }
    // A formatter that succeeded owns line wrapping for its file, so its
    // over-length warnings are stale.
    const remainingWarnings = editWarnings.filter((warning) => !formattedPaths.has(warning.path));
    if (remainingWarnings.length > 0) {
      console.error(color.yellow(`Applied ${remainingWarnings.length} edit(s) worth re-checking:`));
      for (const warning of remainingWarnings)
        console.error(`  ${warning.path}:${warning.line}  ${warning.detail}`);
    }
  },
);

cli(
  {
    name: "audit",
    commands: [preflightCmd, applyCmd],
  },
  (parsed) => {
    parsed.showHelp();
  },
);
