import { join } from "node:path";
import { isCleanTree } from "../../../apply/branch";
import { color } from "../../../apply/report";
import {
  type CollectedComment,
  type CollectOptions,
  collectDiff,
  collectRepo,
  type MrSource,
  resolveMrSource,
} from "../../../detection/collect";
import { densityWeights, type ScoredFile } from "../../../detection/density";
import type { DiffOptions } from "../../../detection/diff";
import { rankCommentsWeighted, type SortKey } from "../../../detection/rank";
import type { JudgeAdapter } from "../../../judge/adapter";
import { buildJob, type BuildJobOptions, writeJob, type WrittenJob } from "../../../judge/job";
import { AuditError, type AuditIo } from "./io";

/**
 * Fixed token cost of one judging agent beyond its comment payload: the Claude
 * Code system prompt and tool schemas (~15k), the rubric read (~2.5k), and the
 * multi-turn read/write/output cycle. The preflight estimate is the number the
 * user consents to, so it must include this cost; overhead dominates payload
 * at the default shard size.
 */
const AGENT_OVERHEAD_TOKENS = 25_000;

export interface PreflightOptions {
  /** Diff scope: comments introduced vs the merge-base with this ref. */
  base?: string | undefined;
  /** Diff scope: comments introduced by a GitLab merge request (iid). */
  mr?: string | undefined;
  /** Repo scope: every tracked code file's comments. */
  all: boolean;
  pathGlobs?: string[] | undefined;
  sort: SortKey;
  limit?: number | undefined;
  shardSize?: number | undefined;
  fix: boolean;
  /** Where job dirs land. Defaults to the content-keyed dir under the OS tmpdir. */
  jobBase?: string | undefined;
}

export interface PreflightDeps {
  io: AuditIo;
  judge: JudgeAdapter;
}

function preview(text: string): string {
  const firstLine = text.split("\n")[0] ?? "";
  return firstLine.length > 64 ? `${firstLine.slice(0, 61)}...` : firstLine;
}

async function collect(
  options: PreflightOptions,
  onFileDensity: (file: ScoredFile) => void,
): Promise<CollectedComment[]> {
  const scope: CollectOptions = { onFileDensity };
  if (options.pathGlobs) scope.pathGlobs = options.pathGlobs;
  if (options.all) {
    if (!(await isCleanTree())) {
      throw new AuditError(
        "Working tree is not clean. --all reads the working tree but applies from HEAD. Commit or stash first.",
      );
    }
    return collectRepo(scope);
  }
  const diff: DiffOptions = {};
  if (options.base != null && options.base !== "") diff.base = options.base;
  if (options.mr != null && options.mr !== "") diff.mr = options.mr;
  let mrSource: MrSource | null = null;
  if (diff.mr != null) {
    mrSource = await resolveMrSource(diff.mr);
    if (!mrSource) {
      throw new AuditError("Could not resolve the merge request's source ref via glab.");
    }
  }
  return collectDiff(diff, mrSource, scope);
}

/**
 * Collect and rank the in-scope comments, materialize the judging job on disk,
 * print the cost summary, and hand the job to the judge. Returns the written job,
 * or null when nothing was in scope. Runs from the repo root.
 */
export async function preflight(
  options: PreflightOptions,
  deps: PreflightDeps,
): Promise<WrittenJob | null> {
  const { io, judge } = deps;

  // Per-file added-line density, gathered while collect has each file's
  // content in hand, weights the ranking so the shard budget lands on the
  // heaviest files first.
  const densities: ScoredFile[] = [];
  const comments = await collect(options, (file) => densities.push(file));

  const ranked = rankCommentsWeighted(comments, densityWeights(densities), options.sort);
  const limited = typeof options.limit === "number" ? ranked.slice(0, options.limit) : ranked;
  if (limited.length === 0) {
    io.log(color.dim("No comments to judge."));
    return null;
  }

  const jobOptions: BuildJobOptions = { fix: options.fix };
  if (options.shardSize != null && options.shardSize !== 0)
    jobOptions.shardSize = options.shardSize;
  const descriptor = await buildJob(limited, jobOptions);
  const written = await writeJob(descriptor, options.jobBase);
  // An --mr job records comment text from the remote MR ref, but apply trims
  // the local tree from HEAD. Persist the scope so apply can refuse to branch
  // off a local checkout that would read every comment as drift.
  await Bun.write(join(written.jobDir, "scope.json"), JSON.stringify({ mr: options.mr ?? null }));

  // Deterministic features per judged comment, keyed by the same id the
  // verdicts use. Each run leaves a (features, verdict) pair in its job dir,
  // the training data for routing obvious comments away from the judge later.
  const features = Object.fromEntries(
    limited.map((c) => [
      c.id,
      { path: c.path, startLine: c.startLine, provenance: c.provenance ?? null, ...c.features },
    ]),
  );
  await Bun.write(join(written.jobDir, "features.json"), JSON.stringify(features, null, 2));

  const fileCount = new Set(limited.map((c) => c.path)).size;
  const payloadTokens = Math.ceil(
    limited.reduce((sum, c) => sum + c.text.length + c.context.length, 0) / 4,
  );
  const tokens = payloadTokens + written.shardCount * AGENT_OVERHEAD_TOKENS;

  io.log(
    color.bold(
      `${limited.length} comments / ${fileCount} files / ~${written.shardCount} agents / ~${tokens} tokens (rough)`,
    ),
  );
  for (const c of limited.slice(0, 10)) {
    io.log(
      `  ${color.dim(String(c.score.score).padStart(5))}  ${c.path}:${c.startLine}  ${preview(c.text)}`,
    );
  }
  io.log("");

  await judge(written);
  return written;
}
