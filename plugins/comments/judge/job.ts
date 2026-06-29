import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CollectedComment } from "../detection/collect";
import type { CommentKind, Language } from "../detection/types";
import { BATCH_SIZE, loadPrompt, sha256 } from "./judge";
import { batchVerdictKeyedSchema } from "./schema";

/** What an agent reads to judge one comment: id-tagged, with rubric context. */
export interface ShardComment {
  id: string;
  path: string;
  language: Language;
  kind: CommentKind;
  text: string;
  context: string;
}

export interface JobShard {
  id: number;
  comments: ShardComment[];
}

export interface JobDescriptor {
  shards: JobShard[];
  promptText: string;
  promptSha: string;
}

export interface BuildJobOptions {
  shardSize?: number;
  fix: boolean;
}

/** The `--fix` rider, appended verbatim to the rubric for the run that asks for suggestions. */
const FIX_INSTRUCTION =
  "For this run, populate suggestedFix for every flagged comment with a concrete rewrite, trim, or delete.";

function toShardComment(comment: CollectedComment): ShardComment {
  return {
    id: comment.id,
    path: comment.path,
    language: comment.language,
    kind: comment.kind,
    text: comment.text,
    context: comment.context,
  };
}

/**
 * Partition ranked comments into shards, preserving rank order so the biggest
 * wins judge and stream first, and pin the prompt. The Bun side shards once. The
 * sandboxed Workflow cannot re-shard, so one shard maps 1:1 to one agent.
 */
export async function buildJob(
  comments: CollectedComment[],
  options: BuildJobOptions,
): Promise<JobDescriptor> {
  const shardSize = options.shardSize ?? BATCH_SIZE;
  const base = await loadPrompt();
  const promptText = options.fix ? `${base.text}\n\n${FIX_INSTRUCTION}` : base.text;

  const shards: JobShard[] = [];
  for (let i = 0; i < comments.length; i += shardSize) {
    shards.push({
      id: shards.length,
      comments: comments.slice(i, i + shardSize).map(toShardComment),
    });
  }

  return { shards, promptText, promptSha: base.sha256 };
}

/** A shard's id paired with the path the agent reads it from. */
export interface ShardRef {
  id: number;
  path: string;
}

/** The Workflow `args`: how each agent finds its shard, the rubric, and where verdicts land. */
export interface JobArgs {
  shards: ShardRef[];
  promptText: string;
  promptSha: string;
  schema: Record<string, unknown>;
  verdictsDir: string;
}

export interface WrittenJob {
  jobDir: string;
  argsPath: string;
  verdictsDir: string;
  shards: ShardRef[];
  count: number;
  shardCount: number;
}

export const DEFAULT_JOB_BASE = join(tmpdir(), "comments-audit");

/** Content-hash the descriptor so re-running identical input reuses the same job dir. */
function jobHash(descriptor: JobDescriptor): string {
  return sha256(
    JSON.stringify({ shards: descriptor.shards, promptSha: descriptor.promptSha }),
  ).slice(0, 16);
}

/**
 * Materialize the job under a content-keyed dir: one `shard-<n>.json` per shard
 * and a `job-args.json` the model hands to the Workflow tool. The verdicts dir is
 * created so agents can `Bash`-write into it. Apply reads the shards back to know
 * which files were judged, then re-extracts to recover each comment's range.
 */
export async function writeJob(
  descriptor: JobDescriptor,
  baseDir: string = DEFAULT_JOB_BASE,
): Promise<WrittenJob> {
  const jobDir = join(baseDir, jobHash(descriptor));
  const verdictsDir = join(jobDir, "verdicts");

  const shardWrites = descriptor.shards.map((shard) => ({
    ref: { id: shard.id, path: join(jobDir, `shard-${shard.id}.json`) },
    body: JSON.stringify(shard, null, 2),
  }));
  const shards: ShardRef[] = shardWrites.map((write) => write.ref);
  await Promise.all(shardWrites.map((write) => Bun.write(write.ref.path, write.body)));

  const args: JobArgs = {
    shards,
    promptText: descriptor.promptText,
    promptSha: descriptor.promptSha,
    schema: batchVerdictKeyedSchema(),
    verdictsDir,
  };
  const argsPath = join(jobDir, "job-args.json");
  await Bun.write(argsPath, JSON.stringify(args, null, 2));

  await mkdir(verdictsDir, { recursive: true });

  const count = descriptor.shards.reduce((total, shard) => total + shard.comments.length, 0);
  return {
    jobDir,
    argsPath,
    verdictsDir,
    shards,
    count,
    shardCount: descriptor.shards.length,
  };
}
