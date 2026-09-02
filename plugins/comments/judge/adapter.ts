import { join } from "node:path";
import { readShard, type ShardComment, type WrittenJob } from "./job";
import type { Verdict } from "./schema";

/**
 * The judge seam. Given a written job, get one `verdict-<shard id>.json` per
 * shard into `job.verdictsDir`, each holding
 * `{ verdicts: [{ id: <comment id>, verdict: { ... } }] }`. Apply reads that
 * directory and knows nothing about who filled it.
 */
export type JudgeAdapter = (job: WrittenJob) => Promise<void>;

export const WORKFLOW_PATH = join(import.meta.dirname, "..", "workflow", "judge.workflow.js");

/**
 * The production judge: hand the job to the Workflow tool. The skill reads the
 * `<preflight>` block, asks the user to confirm, and fans out one agent per
 * shard. Those agents write the verdict files, so in-process there is nothing
 * more to do.
 */
export function workflowJudge(log: (line: string) => void): JudgeAdapter {
  return (job) => {
    log("<preflight>");
    log(
      JSON.stringify({
        scriptPath: WORKFLOW_PATH,
        argsPath: job.argsPath,
        jobDir: job.jobDir,
        count: job.count,
        shardCount: job.shardCount,
      }),
    );
    log("</preflight>");
    return Promise.resolve();
  };
}

/** Where a shard's verdict file lands, the name the workflow prompt spells out to each agent. */
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
