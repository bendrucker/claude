#!/usr/bin/env bun
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { cli } from "cleye";

// Scores the before/after refined issues produced by an A/B run and prints the
// per-brief delta. Expects ab/out/<brief>.<before|after>.md to exist. The
// mechanical score is the rubric-as-code; the judgment findings are left to a
// separate LLM judge.

const argv = cli({
  name: "ab-report",
  flags: {
    out: {
      type: String,
      default: `${import.meta.dir}/../ab/out`,
      description: "Directory of <brief>.<version>.md outputs",
    },
    score: {
      type: String,
      default: `${import.meta.dir}/score.ts`,
      description: "Path to score.ts",
    },
  },
});

async function score(file: string): Promise<{ score: number; byFinding: Record<number, number> }> {
  const proc = Bun.spawn(["bun", argv.flags.score, "--input", file, "--json"], { stdout: "pipe" });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return JSON.parse(out);
}

const files = await readdir(argv.flags.out);
const briefs = [
  ...new Set(
    files.filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.(before|after)\.md$/, "")),
  ),
].sort();

const FINDING_NAME: Record<number, string> = {
  1: "headings",
  2: "issue/PR refs",
  3: "line numbers",
  4: "jargon",
  5: "structure",
  6: "title",
};

let totalBefore = 0;
let totalAfter = 0;
for (const brief of briefs) {
  const beforeFile = join(argv.flags.out, `${brief}.before.md`);
  const afterFile = join(argv.flags.out, `${brief}.after.md`);
  if (!(await Bun.file(beforeFile).exists()) || !(await Bun.file(afterFile).exists())) {
    console.log(`${brief}: missing before/after output, skipping`);
    continue;
  }
  const b = await score(beforeFile);
  const a = await score(afterFile);
  totalBefore += b.score;
  totalAfter += a.score;
  const delta = a.score - b.score;
  const arrow = delta < 0 ? "improved" : delta > 0 ? "regressed" : "unchanged";
  console.log(`\n${brief}`);
  console.log(
    `  score   before ${b.score}  ->  after ${a.score}   (${delta >= 0 ? "+" : ""}${delta}, ${arrow})`,
  );
  const findings = [...new Set([...Object.keys(b.byFinding), ...Object.keys(a.byFinding)])]
    .map(Number)
    .sort((x, y) => x - y);
  for (const f of findings) {
    const bn = b.byFinding[f] ?? 0;
    const an = a.byFinding[f] ?? 0;
    if (bn === an) continue;
    console.log(`    finding ${f} (${FINDING_NAME[f]}): ${bn} -> ${an}`);
  }
}

console.log(`\n${"=".repeat(40)}`);
console.log(`total mechanical score: before ${totalBefore}  ->  after ${totalAfter}`);
console.log("(lower is better; this is the rubric-as-code, not the LLM judge)");
