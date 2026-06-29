#!/usr/bin/env bun

import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { $ } from "bun";
import { cli, command } from "cleye";
import { applyToBranch, isCleanTree } from "../../../apply/branch";
import { computeFileEdits, type EditItem } from "../../../apply/edits";
import { collectVerdicts, hasDrifted, type JoinedItem, joinVerdicts } from "../../../apply/join";
import { color, type ReportItem, renderReport } from "../../../apply/report";
import {
  type CollectedComment,
  collectDiff,
  collectRepo,
  type MrSource,
  resolveMrSource,
} from "../../../detection/collect";
import type { DiffOptions } from "../../../detection/diff";
import { rankComments, type SortKey } from "../../../detection/rank";
import { detectTells } from "../../../detection/tells";
import { buildJob, type Manifest, writeJob } from "../../../judge/job";

const WORKFLOW_PATH = join(import.meta.dirname, "..", "..", "..", "workflow", "judge.workflow.js");

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
      fix: {
        type: Boolean,
        default: false,
        description: "Ask the judge for a suggestion per finding",
      },
    },
  },
  async (parsed) => {
    await chdirToRepoRoot();
    const { base, mr, all, path, sort, limit, fix } = parsed.flags;
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

    const descriptor = await buildJob(limited, { fix });
    const written = await writeJob(descriptor);
    // An --mr job records comment text from the remote MR ref, but apply trims
    // the local tree from HEAD. Persist the scope so apply can refuse to branch
    // off a local checkout that would read every comment as drift.
    await Bun.write(join(written.jobDir, "scope.json"), JSON.stringify({ mr: mr ?? null }));

    const fileCount = new Set(limited.map((c) => c.path)).size;
    const tokens = Math.ceil(
      limited.reduce((sum, c) => sum + c.text.length + c.context.length, 0) / 4,
    );

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

function toReportItem(item: JoinedItem): ReportItem {
  return {
    path: item.entry.path,
    startLine: item.entry.startLine,
    // ManifestEntry is a superset of Comment, so detectTells reads it directly.
    tells: detectTells(item.entry),
    verdict: item.verdict,
  };
}

function toEditItem(item: JoinedItem): EditItem {
  return {
    startLine: item.entry.startLine,
    endLine: item.entry.endLine,
    startColumn: item.entry.startColumn,
    endColumn: item.entry.endColumn,
    kind: item.entry.kind,
    verdict: item.verdict,
  };
}

async function readVerdictShards(verdictsDir: string): Promise<unknown[]> {
  let names: string[];
  try {
    names = await readdir(verdictsDir);
  } catch {
    return [];
  }
  const verdictFiles = names.filter(
    (name) => name.startsWith("verdict-") && name.endsWith(".json"),
  );
  return Promise.all(
    verdictFiles.map(async (name) => JSON.parse(await Bun.file(join(verdictsDir, name)).text())),
  );
}

const applyCmd = command(
  {
    name: "apply",
    flags: {
      job: { type: String, description: "The job dir printed by preflight" },
      report: { type: Boolean, default: false, description: "Print findings instead of applying" },
      fix: { type: Boolean, default: false, description: "Include suggestions in the report" },
    },
  },
  async (parsed) => {
    await chdirToRepoRoot();
    const { job, report, fix } = parsed.flags;
    if (!job) {
      console.error("--job <dir> is required.");
      process.exit(1);
    }

    const manifestFile = Bun.file(join(job, "manifest.json"));
    if (!(await manifestFile.exists())) {
      console.error(`No manifest at ${job}. Pass the job dir printed by preflight.`);
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

    const manifest = JSON.parse(await manifestFile.text()) as Manifest;
    const shards = await readVerdictShards(join(job, "verdicts"));
    if (shards.length === 0) {
      console.error(`No verdicts in ${join(job, "verdicts")}. Run the judge workflow first.`);
      process.exit(1);
    }
    const items = joinVerdicts(manifest, collectVerdicts(shards));

    const byPath = new Map<string, JoinedItem[]>();
    for (const item of items) {
      const list = byPath.get(item.entry.path) ?? [];
      list.push(item);
      byPath.set(item.entry.path, list);
    }

    const reportItems: ReportItem[] = [];
    const editsByPath = new Map<string, string>();
    const driftSkips: string[] = [];
    const manualSkips: string[] = [];

    for (const [path, group] of byPath) {
      const file = Bun.file(path);
      const source = (await file.exists()) ? await file.text() : null;
      const editItems: EditItem[] = [];
      for (const item of group) {
        reportItems.push(toReportItem(item));
        if (!item.verdict.isSlop) continue;
        if (source == null || hasDrifted(source, item.entry)) {
          driftSkips.push(`${path}:${item.entry.startLine}`);
          continue;
        }
        editItems.push(toEditItem(item));
      }
      if (source != null && editItems.length > 0) {
        const result = computeFileEdits(source, editItems);
        for (const skip of result.skips)
          manualSkips.push(`${path}:${skip.startLine}  ${skip.detail}`);
        if (result.content !== source) editsByPath.set(path, result.content);
      }
    }

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
        console.log(
          `Trimmed ${editsByPath.size} file(s) on branch ${color.bold(branch)}. Review with git diff HEAD~1.`,
        );
      }
    }

    if (driftSkips.length > 0) {
      console.error(
        color.yellow(`Skipped ${driftSkips.length} drifted comment(s): ${driftSkips.join(", ")}`),
      );
    }
    if (manualSkips.length > 0) {
      console.error(color.yellow(`Left ${manualSkips.length} comment(s) for manual handling:`));
      for (const skip of manualSkips) console.error(`  ${skip}`);
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
