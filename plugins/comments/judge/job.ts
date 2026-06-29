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

/** The recorded range the applier id-joins a verdict back to. */
export interface ManifestEntry {
  path: string;
  language: Language;
  kind: CommentKind;
  text: string;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
}

export type Manifest = Record<string, ManifestEntry>;

export interface JobDescriptor {
  shards: JobShard[];
  manifest: Manifest;
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

function toManifestEntry(comment: CollectedComment): ManifestEntry {
  return {
    path: comment.path,
    language: comment.language,
    kind: comment.kind,
    text: comment.text,
    startLine: comment.startLine,
    endLine: comment.endLine,
    startColumn: comment.startColumn,
    endColumn: comment.endColumn,
  };
}

/**
 * Partition ranked comments into shards (preserving rank order so the biggest
 * win judge and stream first), load and pin the prompt, and record the manifest
 * the applier joins against. The Bun side shards once. The sandboxed Workflow
 * cannot re-shard, so one shard maps 1:1 to one agent.
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

  const manifest: Manifest = {};
  for (const comment of comments) manifest[comment.id] = toManifestEntry(comment);

  return { shards, manifest, promptText, promptSha: base.sha256 };
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
    JSON.stringify({
      shards: descriptor.shards,
      manifest: descriptor.manifest,
      promptSha: descriptor.promptSha,
    }),
  ).slice(0, 16);
}

/**
 * Materialize the job under a content-keyed dir: one `shard-<n>.json` per shard,
 * a `manifest.json`, and a `job-args.json` the model hands to the Workflow tool.
 * The verdicts dir is created so agents can `Bash`-write into it.
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

  await Bun.write(join(jobDir, "manifest.json"), JSON.stringify(descriptor.manifest, null, 2));

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

  return {
    jobDir,
    argsPath,
    verdictsDir,
    shards,
    count: Object.keys(descriptor.manifest).length,
    shardCount: descriptor.shards.length,
  };
}
