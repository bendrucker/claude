export const meta = {
  name: "comments-judge",
  description: "Judge extracted code comments for AI slop, one agent per shard",
  phases: [{ title: "Judge" }],
};

// job = { shards: [{ id, path }], promptPath, promptSha, schema, verdictsDir }
// The Workflow tool delivers args as a JSON string, so parse it before use.
// The Bun side already sharded in ranked order, so each shard maps 1:1 to one
// agent. The schema reaches the agent through args; the rubric is a file the agent
// reads (job.promptPath), keeping the large rubric text out of the tool-call args
// and the sandboxed script free of imports. The summary is logged rather than
// returned: the verdicts live on disk for the apply step, off the orchestrator
// context, and a top-level return is not valid module syntax.

const job = typeof args === "string" ? JSON.parse(args) : args;
const CONCURRENCY = 8;

async function judgeShard(shardPath, shardId) {
  const prompt = [
    `Read the comment-slop rubric at this exact path: ${job.promptPath}`,
    `Read the JSON file at this exact path: ${shardPath}`,
    'It contains { "id": <shard id>, "comments": [{ "id", "path", "language", "kind", "text", "context" }] }.',
    'Judge every comment in the shard against the rubric. Produce exactly one verdict per comment, keyed by its "id".',
    `Write the object { "verdicts": [{ "id": <comment id>, "verdict": { ... } }] } to this exact path with a Bash heredoc: ${job.verdictsDir}/verdict-${shardId}.json`,
    'Return that same { "verdicts": [...] } object as your structured output.',
  ].join("\n");
  return agent(prompt, {
    schema: job.schema,
    label: `judge:shard-${shardId}`,
    phase: "Judge",
  });
}

phase("Judge");

const shards = job.shards;
const results = [];
for (let i = 0; i < shards.length; i += CONCURRENCY) {
  const batch = shards.slice(i, i + CONCURRENCY);
  const batchResults = await parallel(batch.map((shard) => () => judgeShard(shard.path, shard.id)));
  results.push(...batchResults);
}

let flagged = 0;
for (const result of results) {
  if (result && Array.isArray(result.verdicts)) {
    flagged += result.verdicts.filter(
      (entry) => entry.verdict?.action && entry.verdict.action !== "keep",
    ).length;
  }
}

log(`Judged ${shards.length} shard(s); ${flagged} flagged. Verdicts in ${job.verdictsDir}`);
