import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { type Provenance, ProvenanceSchema } from "../detection/provenance";
import type { CommentKind, Language } from "../detection/types";
import { BATCH_SIZE, loadPrompt, sha256 } from "./judge";

/** What an agent reads to judge one comment: id-tagged, with rubric context. */
export interface ShardComment {
  id: string;
  path: string;
  language: Language;
  kind: CommentKind;
  text: string;
  context: string;
  /** Who last touched the comment's lines, when the local blame describes them. */
  provenance?: Provenance | undefined;
}

export interface JobShard {
  id: number;
  comments: ShardComment[];
}

const ShardFile = z.object({
  id: z.number(),
  comments: z.array(
    z.object({
      id: z.string(),
      path: z.string(),
      language: z.string(),
      kind: z.enum(["line", "block", "docstring"]),
      text: z.string(),
      context: z.string(),
      provenance: ProvenanceSchema.optional(),
    }),
  ),
}) satisfies z.ZodType<JobShard>;

/** A shard read back from the file `writeJob` wrote. */
export async function readShard(path: string): Promise<JobShard> {
  return ShardFile.parse(JSON.parse(await Bun.file(path).text()));
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

function toShardComment(comment: ShardComment): ShardComment {
  return {
    id: comment.id,
    path: comment.path,
    language: comment.language,
    kind: comment.kind,
    text: comment.text,
    context: comment.context,
    provenance: comment.provenance,
  };
}

/**
 * Partition ranked comments into shards, preserving rank order so the biggest
 * wins judge and stream first, and pin the prompt. The Bun side shards once. The
 * sandboxed Workflow cannot re-shard, so one shard maps 1:1 to one agent.
 *
 * Takes the shard fields alone, so the audit passes `CollectedComment`s and the
 * eval passes fixtures, and both reach the agents through the same writer.
 */
export async function buildJob(
  comments: ShardComment[],
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
  promptPath: string;
  promptSha: string;
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

/**
 * Content-hash the descriptor so re-running identical input reuses the same job
 * dir. The full prompt text is hashed, not the rubric's sha alone, so a `--fix`
 * run lands in its own dir instead of reading the plain run's verdicts.
 */
function jobHash(descriptor: JobDescriptor): string {
  return sha256(
    JSON.stringify({ shards: descriptor.shards, promptText: descriptor.promptText }),
  ).slice(0, 16);
}

/**
 * Materialize the job under a content-keyed dir: one `shard-<n>.json` per shard,
 * the rubric as `prompt.md`, and a `job-args.json` the model hands to the Workflow
 * tool. The rubric is a file the judging agent reads rather than args text, so the
 * args the model passes stay small. The verdicts dir is created so agents can
 * `Bash`-write into it. Apply reads the shards back to know which files were
 * judged, then re-extracts to recover each comment's range.
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

  const promptPath = join(jobDir, "prompt.md");
  await Bun.write(promptPath, descriptor.promptText);

  const args: JobArgs = {
    shards,
    promptPath,
    promptSha: descriptor.promptSha,
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
