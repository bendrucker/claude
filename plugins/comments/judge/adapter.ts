import { join } from "node:path";
import { readShard, type ShardComment, type ShardRef, type WrittenJob } from "./job";
import type { Verdict } from "./schema";

/**
 * The judge seam. Given a written job, get one `verdict-<shard id>.json` per
 * shard into `job.verdictsDir`, each holding
 * `{ verdicts: [{ id: <comment id>, verdict: { ... } }] }`. Apply reads that
 * directory and knows nothing about who filled it.
 */
export type JudgeAdapter = (job: WrittenJob) => Promise<void>;

/** The plugin agent that judges one shard. Its frontmatter pins the model and effort the eval gate cleared. */
export const JUDGE_AGENT = "comments:judge";

/** The prompt one judge agent gets, naming every path it reads or writes. */
export function judgePrompt(job: WrittenJob, ref: ShardRef): string {
  return `Rubric: ${job.promptPath}\nShard: ${ref.path}\nVerdicts: ${verdictPath(job.verdictsDir, ref.id)}`;
}

/**
 * Print the `<preflight>` block the session turns into one
 * `Agent` call per shard. Those agents write the verdict files, so in-process
 * there is nothing more to do.
 */
export function agentJudge(log: (line: string) => void): JudgeAdapter {
  return (job) => {
    log("<preflight>");
    log(
      JSON.stringify({
        agent: JUDGE_AGENT,
        prompts: job.shards.map((ref) => judgePrompt(job, ref)),
        jobDir: job.jobDir,
        count: job.count,
        shardCount: job.shardCount,
      }),
    );
    log("</preflight>");
    return Promise.resolve();
  };
}

/** Where a shard's verdict file lands, the path each judge prompt names. */
export function verdictPath(verdictsDir: string, shardId: number): string {
  return join(verdictsDir, `verdict-${shardId}.json`);
}

/** Scores one shard's comments, returning verdicts in the same order. */
export type ShardJudge = (comments: ShardComment[]) => Promise<Verdict[]>;

/**
 * An in-process judge behind the same seam: read each shard back from disk,
 * score it, and write its verdict file in the shape the agents write. Shards
 * score concurrently, matching the agent fan-out.
 */
export function shardJudge(judge: ShardJudge): JudgeAdapter {
  return async (job) => {
    await Promise.all(
      job.shards.map(async (ref) => {
        const shard = await readShard(ref.path);
        const verdicts = await judge(shard.comments);
        if (verdicts.length !== shard.comments.length) {
          throw new Error(
            `Judge returned ${verdicts.length} verdicts for ${shard.comments.length} comments in shard ${ref.id}`,
          );
        }
        const entries = shard.comments.map((comment, i) => ({
          id: comment.id,
          verdict: verdicts[i],
        }));
        await Bun.write(
          verdictPath(job.verdictsDir, ref.id),
          JSON.stringify({ verdicts: entries }, null, 2),
        );
      }),
    );
  };
}
