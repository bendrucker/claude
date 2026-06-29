export const meta = {
  name: "comments-judge",
  description: "Judge extracted code comments for AI slop, one agent per shard",
  phases: [{ title: "Judge" }],
};

// args = { shards: [{ id, path }], promptText, promptSha, schema, verdictsDir }
// The Bun side already sharded in ranked order, so each shard maps 1:1 to one
// agent. The rubric and schema reach the agent only through args, never an
// import, so the script stays sandbox-safe. The summary is logged rather than
// returned: the verdicts live on disk for the apply step, off the orchestrator
// context, and a top-level return is not valid module syntax.

const CONCURRENCY = 8;

async function judgeShard(shardPath, shardId) {
  const prompt = [
    args.promptText,
    "",
    "---",
    "",
    `Read the JSON file at this exact path: ${shardPath}`,
    'It contains { "id": <shard id>, "comments": [{ "id", "path", "language", "kind", "text", "context" }] }.',
    'Judge every comment in the shard against the rubric above. Produce exactly one verdict per comment, keyed by its "id".',
    `Write the object { "verdicts": [{ "id": <comment id>, "verdict": { ... } }] } to this exact path with a Bash heredoc: ${args.verdictsDir}/verdict-${shardId}.json`,
    'Return that same { "verdicts": [...] } object as your structured output.',
  ].join("\n");
  return agent(prompt, {
    schema: args.schema,
    label: `judge:shard-${shardId}`,
    phase: "Judge",
  });
}

phase("Judge");

const shards = args.shards;
const results = [];
for (let i = 0; i < shards.length; i += CONCURRENCY) {
  const batch = shards.slice(i, i + CONCURRENCY);
  const batchResults = await parallel(batch.map((shard) => () => judgeShard(shard.path, shard.id)));
  results.push(...batchResults);
}

let flagged = 0;
for (const result of results) {
  if (result && Array.isArray(result.verdicts)) {
    flagged += result.verdicts.filter((entry) => entry.verdict?.isSlop).length;
  }
}

log(`Judged ${shards.length} shard(s); ${flagged} flagged. Verdicts in ${args.verdictsDir}`);
