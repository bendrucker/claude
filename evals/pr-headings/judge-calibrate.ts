import { readFileSync } from "node:fs";
import { join } from "node:path";
import { classifyPrHeading } from "./classifier";
import {
  HEADING_BATCH_SIZE,
  type JudgeInput,
  JUDGE_MODEL,
  type JudgeVerdict,
  judgeHeadings,
  loadPrompt,
  renderInput,
} from "./judge";

interface Label {
  text: string;
  words: number;
  kind: string;
  url: string;
  verdict: "good" | "bad" | "skip" | null;
  notes: string;
  rewrite: string;
}

interface HeadingRow {
  text: string;
  words: number;
  depth: number;
  url: string;
}

interface ManifestEntry {
  file: string;
  url: string;
}

const DIR = import.meta.dirname;
const EXCERPT_LIMIT = 600;

const labels: Label[] = JSON.parse(readFileSync(join(DIR, "labels.json"), "utf8"));
const headings: HeadingRow[] = JSON.parse(readFileSync(join(DIR, "headings.json"), "utf8"));
const manifest: ManifestEntry[] = JSON.parse(readFileSync(join(DIR, "manifest.json"), "utf8"));

const urlToFile = new Map<string, string>();
for (const m of manifest) {
  if (!urlToFile.has(m.url)) urlToFile.set(m.url, m.file);
}

// First-occurrence-by-text index over headings.json, mirroring build-label-html.ts:
// filter words >= 3, sort by words desc, then keep the first row per text. The
// labeling set was built from this same ordering, so the lookup matches it.
const headingByText = new Map<string, HeadingRow>();
{
  const seen = new Set<string>();
  const sorted = headings.filter((h) => h.words >= 3).sort((a, b) => b.words - a.words);
  for (const h of sorted) {
    if (!seen.has(h.text)) {
      seen.add(h.text);
      headingByText.set(h.text, h);
    }
  }
}

const bodyCache = new Map<string, string[]>();
function bodyLines(file: string): string[] {
  const cached = bodyCache.get(file);
  if (cached) return cached;
  let lines: string[] = [];
  try {
    lines = readFileSync(join(DIR, "bodies", file), "utf8").split("\n");
  } catch {
    lines = [];
  }
  bodyCache.set(file, lines);
  return lines;
}

const HEADING_RE = /^(#{1,6})\s+(.*\S)\s*$/;

function headingLevel(line: string): number | null {
  const m = line.match(HEADING_RE);
  return m ? m[1].length : null;
}

function headingTextOf(line: string): string | null {
  const m = line.match(HEADING_RE);
  return m ? m[2].trim() : null;
}

interface Context {
  parent: string;
  excerpt: string;
  found: boolean;
}

// Section excerpt (heading down to the next heading of equal-or-higher level)
// reuses build-label-html.ts's extractExcerpt logic. The parent is the nearest
// preceding heading of strictly higher level (lower #-count), or "(top level)".
function extractContext(file: string, text: string): Context {
  const lines = bodyLines(file);
  for (let i = 0; i < lines.length; i++) {
    const lvl = headingLevel(lines[i]);
    if (lvl === null) continue;
    if (headingTextOf(lines[i]) !== text) continue;

    let parent = "(top level)";
    for (let j = i - 1; j >= 0; j--) {
      const plvl = headingLevel(lines[j]);
      if (plvl !== null && plvl < lvl) {
        parent = headingTextOf(lines[j]) ?? "(top level)";
        break;
      }
    }

    const collected: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const nlvl = headingLevel(lines[j]);
      if (nlvl !== null && nlvl <= lvl) break;
      collected.push(lines[j]);
    }
    let excerpt = collected.join("\n").trim();
    if (excerpt.length > EXCERPT_LIMIT) excerpt = `${excerpt.slice(0, EXCERPT_LIMIT).trimEnd()}…`;
    return { parent, excerpt, found: true };
  }
  return { parent: "(top level)", excerpt: "", found: false };
}

interface Assembled {
  input: JudgeInput;
  label: Label;
  classifierFlagged: boolean;
}

const labeled = labels.filter((l) => l.verdict === "good" || l.verdict === "bad");

const assembled: Assembled[] = [];
const unjoined: string[] = [];
const bodyMisses: string[] = [];

labeled.forEach((label, index) => {
  const row = headingByText.get(label.text);
  const file = row ? urlToFile.get(row.url) : undefined;
  let context: Context = { parent: "(top level)", excerpt: "", found: false };
  if (file) {
    context = extractContext(file, label.text);
  }
  if (!row) unjoined.push(label.text);
  else if (!context.found) bodyMisses.push(label.text);

  assembled.push({
    input: { index, heading: label.text, parent: context.parent, excerpt: context.excerpt },
    label,
    classifierFlagged: classifyPrHeading(label.text).flagged,
  });
});

interface Scores {
  tp: number;
  fp: number;
  tn: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
  accuracy: number;
}

function score(rows: { flagged: boolean; bad: boolean }[]): Scores {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  for (const r of rows) {
    if (r.bad && r.flagged) tp++;
    else if (r.bad && !r.flagged) fn++;
    else if (!r.bad && r.flagged) fp++;
    else tn++;
  }
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const accuracy = rows.length > 0 ? (tp + tn) / rows.length : 0;
  return { tp, fp, tn, fn, precision, recall, f1, accuracy };
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function printScores(name: string, s: Scores): void {
  console.log(
    `${name.padEnd(20)} P=${pct(s.precision)}  R=${pct(s.recall)}  F1=${pct(s.f1)}  acc=${pct(s.accuracy)}  (TP=${s.tp} FP=${s.fp} TN=${s.tn} FN=${s.fn})`,
  );
}

const TOKENS_PER_WORD = 1.35;
const OUTPUT_TOKENS_PER_CALL = 400;
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-opus-4-8": { input: 5, output: 25 },
};

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

async function main(): Promise<void> {
  console.log(`Assembled ${assembled.length} labeled items (good/bad).`);
  console.log(
    `  bad: ${labeled.filter((l) => l.verdict === "bad").length}  good: ${labeled.filter((l) => l.verdict === "good").length}`,
  );
  if (unjoined.length > 0) {
    console.log(`\nHeadings not found in headings.json index (${unjoined.length}):`);
    for (const t of unjoined) console.log(`  - "${t}"`);
  }
  if (bodyMisses.length > 0) {
    console.log(`\nHeadings not located in any body markdown (${bodyMisses.length}):`);
    for (const t of bodyMisses) console.log(`  - "${t}"`);
  }
  if (unjoined.length === 0 && bodyMisses.length === 0) {
    console.log("Join is lossless: every labeled heading got a parent + excerpt.");
  }

  const prompt = await loadPrompt();
  const model = JUDGE_MODEL;
  const calls = Math.ceil(assembled.length / HEADING_BATCH_SIZE);

  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

  // Rough token/cost estimate (heuristic: 1.35 tokens/word). The prompt prefix
  // is priced per call at full rate as a conservative upper bound.
  const promptTokens = Math.ceil(countWords(prompt) * TOKENS_PER_WORD);
  let userWords = 0;
  for (const a of assembled) userWords += countWords(renderInput(a.input));
  const inputTokens = calls * promptTokens + Math.ceil(userWords * TOKENS_PER_WORD);
  const outputTokens = calls * OUTPUT_TOKENS_PER_CALL;
  const pricing = PRICING[model] ?? PRICING["claude-sonnet-4-6"];
  const usd = (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;

  console.log(
    `\nEstimate: ${assembled.length} headings in ${calls} batched calls of ${HEADING_BATCH_SIZE} on ${model}`,
  );
  console.log(
    `  ~${inputTokens.toLocaleString()} input + ~${outputTokens.toLocaleString()} output tokens, est. $${usd.toFixed(4)}`,
  );

  if (!hasKey) {
    console.log("\n=== OFFLINE MODE (no ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN) ===");
    console.log("First 3 fully-rendered judge inputs:\n");
    for (const a of assembled.slice(0, 3)) {
      console.log("-".repeat(72));
      console.log(renderInput(a.input));
      console.log(`(Ben's label: ${a.label.verdict})`);
    }
    console.log("-".repeat(72));
    console.log("\nLive calibration needs ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN). Exiting 0.");
    return;
  }

  console.log("\nRunning judge...");
  const verdicts = await judgeHeadings(
    assembled.map((a) => a.input),
    { model, prompt },
  );
  const byIndex = new Map<number, JudgeVerdict>();
  for (const v of verdicts) byIndex.set(v.index, v);

  const rows = assembled.map((a) => {
    const v = byIndex.get(a.input.index);
    const bad = a.label.verdict === "bad";
    return {
      assembled: a,
      verdict: v,
      bad,
      judgeBad: v?.bad ?? false,
      classifierFlagged: a.classifierFlagged,
    };
  });

  const judgeScores = score(rows.map((r) => ({ flagged: r.judgeBad, bad: r.bad })));
  const classifierScores = score(rows.map((r) => ({ flagged: r.classifierFlagged, bad: r.bad })));
  const orScores = score(
    rows.map((r) => ({ flagged: r.judgeBad || r.classifierFlagged, bad: r.bad })),
  );

  console.log("\n=== Judge vs Ben (ground truth) ===");
  printScores("judge", judgeScores);

  console.log("\n=== 3-way comparison ===");
  printScores("classifier", classifierScores);
  printScores("judge", judgeScores);
  printScores("classifier OR judge", orScores);

  const bestSingleF1 = Math.max(classifierScores.f1, judgeScores.f1);
  console.log(
    orScores.f1 > bestSingleF1
      ? `\nThe OR-combination (F1=${pct(orScores.f1)}) beats both alone (best single F1=${pct(bestSingleF1)}).`
      : `\nThe OR-combination (F1=${pct(orScores.f1)}) does NOT beat the best single grader (F1=${pct(bestSingleF1)}).`,
  );

  const judgeFlaggedBenGood = rows.filter((r) => r.judgeBad && !r.bad);
  console.log(`\n=== Judge flagged, Ben good (${judgeFlaggedBenGood.length}) ===`);
  for (const r of judgeFlaggedBenGood) {
    console.log(`  "${r.assembled.input.heading}"`);
    console.log(`      reason: ${r.verdict?.reason ?? ""}`);
    if (r.verdict?.rewrite) console.log(`      rewrite: ${r.verdict.rewrite}`);
  }

  const benBadJudgePassed = rows.filter((r) => r.bad && !r.judgeBad);
  console.log(`\n=== Ben bad, judge passed (${benBadJudgePassed.length}) ===`);
  for (const r of benBadJudgePassed) {
    console.log(`  "${r.assembled.input.heading}"`);
    if (r.assembled.label.notes) console.log(`      Ben's note: ${r.assembled.label.notes}`);
  }
}

await main();
