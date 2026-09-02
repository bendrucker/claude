#!/usr/bin/env bun
import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { cli } from "cleye";
import { z } from "zod";
import { decodeFile } from "../../../../../packages/decode/index";

const Slots = z.object({ "1": z.string(), "2": z.string() });
const Mapping = z.record(z.string(), Slots);

const Verdict = z.object({
  brief: z.string(),
  scores: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
  better: z.union([z.literal("1"), z.literal("2"), z.literal(1), z.literal(2)]),
  reason: z.string().optional(),
});

const Verdicts = z.union([z.object({ verdicts: z.array(Verdict) }), z.array(Verdict)]);

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

if (argv.flags.unblind != null && argv.flags.unblind !== "") {
  const mapping = await decodeFile(Mapping, mappingPath);
  const decoded = await decodeFile(Verdicts, argv.flags.unblind);
  for (const v of Array.isArray(decoded) ? decoded : decoded.verdicts) {
    const map = mapping[v.brief];
    if (!map) throw new Error(`${mappingPath} has no entry for brief ${v.brief}`);
    const better = String(v.better) === "1" ? map["1"] : map["2"];
    const s1 = `${map["1"]}=${v.scores?.["1"] ?? "?"}`;
    const s2 = `${map["2"]}=${v.scores?.["2"] ?? "?"}`;
    console.log(`\n${v.brief}: judge prefers ${better.toUpperCase()}  (${s1}, ${s2})`);
    if (v.reason != null && v.reason !== "") console.log(`  ${v.reason}`);
  }
  process.exit(0);
}

await mkdir(argv.flags.judgeDir, { recursive: true });
const files = await readdir(argv.flags.out);
const briefs = [
  ...new Set(
    files.filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.(before|after)\.md$/, "")),
  ),
].toSorted();

const mapping: Record<string, Record<string, string>> = {};
const blocks = await Promise.all(
  briefs.map(async (brief) => {
    const flip = Math.random() < 0.5;
    const slot1 = flip ? "after" : "before";
    const slot2 = flip ? "before" : "after";
    mapping[brief] = { "1": slot1, "2": slot2 };
    const [v1, v2] = await Promise.all([
      Bun.file(join(argv.flags.out, `${brief}.${slot1}.md`)).text(),
      Bun.file(join(argv.flags.out, `${brief}.${slot2}.md`)).text(),
    ]);
    await Promise.all([
      Bun.write(join(argv.flags.judgeDir, `${brief}.1.md`), v1),
      Bun.write(join(argv.flags.judgeDir, `${brief}.2.md`), v2),
    ]);
    return `#### Brief: ${brief}\n\n--- Version 1 ---\n${v1.trim()}\n\n--- Version 2 ---\n${v2.trim()}`;
  }),
);
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
