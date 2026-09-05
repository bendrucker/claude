export const meta = {
  name: "comments-judge",
  description: "Judge extracted code comments for AI slop, one agent per shard",
  phases: [{ title: "Judge", model: "sonnet" }],
};

// job = { shards: [{ id, path }], promptPath, promptSha, verdictsDir }
// The Workflow tool delivers args as a JSON string, so parse it before use.
// The Bun side already sharded in ranked order, so each shard maps 1:1 to one
// agent. The rubric is a file the agent reads (job.promptPath), keeping the
// large rubric text out of the tool-call args and the sandboxed script free of
// imports. Verdicts land on disk for the apply step, off the orchestrator
// context; `apply/join.ts` validates them there, so the agent's structured
// output is only the small summary the log needs.

const job = typeof args === "string" ? JSON.parse(args) : args;

// The eval gate judges the labeled fixture corpus through this workflow
// (evals/eval.ts build, then score --gate), so the rubric is cleared on the
// model pinned here rather than on whatever the session runs. Re-clear the gate
// on a cheaper model before lowering this.
const JUDGE_MODEL = "sonnet";

const SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    total: { type: "integer" },
    flagged: { type: "integer" },
  },
  required: ["total", "flagged"],
  additionalProperties: false,
};

function judgeShard(shard) {
  const prompt = [
    `Read the comment-slop rubric at this exact path: ${job.promptPath}`,
    `Read the JSON file at this exact path: ${shard.path}`,
    'It contains { "id": <shard id>, "comments": [{ "id", "path", "language", "kind", "text", "context", "provenance"? }] }.',
    "provenance, when present, is the git blame of the comment's lines; the rubric says how to weigh it.",
    'Judge every comment in the shard against the rubric. Produce exactly one verdict per comment, keyed by its "id".',
    `Write the object { "verdicts": [{ "id": <comment id>, "verdict": { ... } }] } to this exact path with the Write tool: ${job.verdictsDir}/verdict-${shard.id}.json`,
    "Use the Write tool, not a Bash heredoc.",
    "Per verdict include: action (keep | trim | rewrite), category (the failing shape, null for keep), confidence (low | medium | high), rationale (one sentence), rewrite (the de-voiced comment text, only when action is rewrite, else null), and trimTo (only for a partial trim: the kept comment rewritten to read as complete sentences, delimiters included, no leading indentation; omit it to delete the whole comment).",
    'Your structured output is only the summary: { "total": <comments judged>, "flagged": <verdicts with action other than keep> }.',
  ].join("\n");
  return agent(prompt, {
    schema: SUMMARY_SCHEMA,
    model: JUDGE_MODEL,
    label: `judge:shard-${shard.id}`,
    phase: "Judge",
  });
}

phase("Judge");

const results = await parallel(job.shards.map((shard) => () => judgeShard(shard)));

let flagged = 0;
for (const result of results) {
  if (typeof result?.flagged === "number") flagged += result.flagged;
}

log(`Judged ${job.shards.length} shard(s); ${flagged} flagged. Verdicts in ${job.verdictsDir}`);
