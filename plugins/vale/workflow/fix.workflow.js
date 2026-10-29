export const meta = {
  name: "vale-fix",
  description: "Rewrite Vale alerts in place, one agent per file",
  phases: [{ title: "Rewrite" }],
};

// job = { config, level, model, shards: [{ id, file, shard }] }, written by `fix.ts preflight`.
const job = typeof args === "string" ? JSON.parse(args) : args;

const SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    fixed: { type: "integer" },
    left: { type: "integer" },
    notes: { type: "string" },
  },
  required: ["fixed", "left", "notes"],
  additionalProperties: false,
};

function rewrite(shard) {
  const prompt = [
    `Fix the Vale alerts in one file. Read the JSON at this exact path: ${shard.shard}`,
    'It holds { "file", "config", "alerts": [{ "line", "span", "check", "severity", "message", "match", "action" }] }. span is a one-based inclusive column range on that line.',
    "Edit only that file, with the Edit tool. Fix each alert the way its message asks. When action names a replacement in its Params, use it.",
    "Rewrite only the sentence that holds an alert. Keep every fact and the sentence's meaning. Keep the markup as written: code spans, fences, links, list markers, tables, and line breaks.",
    "When a fix would change what the sentence claims, leave that alert and say why in notes.",
    `After editing, run \`vale --no-global --config=${job.config} --output=line ${shard.file}\`. Fix any alert your edit introduced. A rewrite that adds an alert is reverted.`,
    'Your structured output is { "fixed": <alerts fixed>, "left": <alerts left>, "notes": <one line per alert left, or "">. }',
  ].join("\n");
  return agent(prompt, {
    schema: SUMMARY_SCHEMA,
    model: job.model,
    label: `rewrite:${shard.file.split("/").slice(-3).join("/")}`,
    phase: "Rewrite",
  });
}

phase("Rewrite");

const results = await parallel(job.shards.map((shard) => () => rewrite(shard)));

let fixed = 0;
let left = 0;
const notes = [];
for (const [index, result] of results.entries()) {
  const { file } = job.shards[index];
  if (result === null) {
    notes.push(`${file}: agent failed`);
    continue;
  }
  fixed += result.fixed;
  left += result.left;
  if (result.notes !== "") notes.push(`${file}: ${result.notes}`);
}

log(`Rewrote ${job.shards.length} file(s): ${fixed} fixed, ${left} left by the agents.`);
return { fixed, left, notes };
