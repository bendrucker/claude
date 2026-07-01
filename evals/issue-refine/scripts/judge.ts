#!/usr/bin/env bun
import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { cli } from "cleye";

// Prepares a blinded LLM-judge run over an A/B output set. For each brief it
// assigns before/after to slots "1" and "2" in random order, copies the outputs
// under neutral names, records the mapping, and prints a judge prompt. A judge
// agent then scores each slot against the rubric without knowing which is the
// edited skill. Unblind with --unblind once the verdict is written.

const argv = cli({
  name: "judge",
  flags: {
    out: {
      type: String,
      default: `${import.meta.dir}/../ab/out`,
      description: "Directory of <brief>.<version>.md outputs",
    },
    judgeDir: {
      type: String,
      default: `${import.meta.dir}/../ab/judge`,
      description: "Working directory for blinded copies and mapping",
    },
    rubric: {
      type: String,
      default: `${import.meta.dir}/../RUBRIC.md`,
      description: "Rubric to judge against",
    },
    unblind: {
      type: String,
      description: "Path to the judge's verdict JSON; prints the de-blinded result and exits",
    },
  },
});

const mappingPath = join(argv.flags.judgeDir, "mapping.json");

if (argv.flags.unblind) {
  const mapping = await Bun.file(mappingPath).json();
  const verdict = await Bun.file(argv.flags.unblind).json();
  for (const v of verdict.verdicts ?? verdict) {
    const map = mapping[v.brief];
    const better = v.better === "1" || v.better === 1 ? map["1"] : map["2"];
    const s1 = `${map["1"]}=${v.scores?.["1"] ?? v.scores?.[1] ?? "?"}`;
    const s2 = `${map["2"]}=${v.scores?.["2"] ?? v.scores?.[2] ?? "?"}`;
    console.log(`\n${v.brief}: judge prefers ${better.toUpperCase()}  (${s1}, ${s2})`);
    if (v.reason) console.log(`  ${v.reason}`);
  }
  process.exit(0);
}

await mkdir(argv.flags.judgeDir, { recursive: true });
const files = await readdir(argv.flags.out);
const briefs = [
  ...new Set(
    files.filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.(before|after)\.md$/, "")),
  ),
].sort();

const mapping: Record<string, Record<string, string>> = {};
const blocks: string[] = [];
for (const brief of briefs) {
  const flip = Math.random() < 0.5;
  const slot1 = flip ? "after" : "before";
  const slot2 = flip ? "before" : "after";
  mapping[brief] = { "1": slot1, "2": slot2 };
  const v1 = await Bun.file(join(argv.flags.out, `${brief}.${slot1}.md`)).text();
  const v2 = await Bun.file(join(argv.flags.out, `${brief}.${slot2}.md`)).text();
  await Bun.write(join(argv.flags.judgeDir, `${brief}.1.md`), v1);
  await Bun.write(join(argv.flags.judgeDir, `${brief}.2.md`), v2);
  blocks.push(
    `#### Brief: ${brief}\n\n--- Version 1 ---\n${v1.trim()}\n\n--- Version 2 ---\n${v2.trim()}`,
  );
}
await Bun.write(mappingPath, JSON.stringify(mapping, null, 2));

const rubric = await Bun.file(argv.flags.rubric).text();
const prompt = `You are judging refined issues against a rubric. For each brief you get two refined issues, Version 1 and Version 2, produced from the same input. Each is a Markdown artifact: YAML frontmatter (title, type, and optional labels, priority, relations) between \`---\` fences, then the body. Score each on how well it follows the rubric, then say which is better. Judge only on the rubric. Do not assume either version is newer or preferred.

================ RUBRIC ================
${rubric.trim()}

================ OUTPUTS TO JUDGE ================
${blocks.join("\n\n")}

================ YOUR TASK ================
Return ONLY a JSON object, no prose around it:
{
  "verdicts": [
    { "brief": "<brief id>", "scores": { "1": <0-10>, "2": <0-10> }, "better": "1" | "2", "reason": "<one or two sentences citing rubric findings by number>" }
  ]
}
A higher score is better (10 = follows the rubric fully). Cite finding numbers (1-7) in each reason.`;

console.log(prompt);
