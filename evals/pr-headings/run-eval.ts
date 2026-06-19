import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { marked } from "marked";
import { classifyPrHeading } from "./classifier";
import {
  HEADING_BATCH_SIZE,
  type JudgeInput,
  type JudgeVerdict,
  JUDGE_MODEL,
  loadPrompt,
  parseVerdicts,
  renderBatch,
  verdictSchema,
} from "./judge";

const DIR = import.meta.dirname;
const GEN_MODEL = "claude-sonnet-4-6";
const ARMS = ["baseline", "treatment"] as const;
type Arm = (typeof ARMS)[number];

interface Scenario {
  id: string;
  url: string;
  title: string;
  repo: string;
  diff: string;
  contextNote: string;
  originalBody: string;
  originalHeadings: string[];
  expectSections: boolean;
  category: string;
}

interface IndexEntry {
  id: string;
  category: string;
  expectSections: boolean;
  originalHeadingCount: number;
}

const index: IndexEntry[] = JSON.parse(
  await Bun.file(join(DIR, "scenarios", "index.json")).text(),
);

async function loadScenario(id: string): Promise<Scenario> {
  return JSON.parse(await Bun.file(join(DIR, "scenarios", `${id}.json`)).text());
}

const systemPrompts: Record<Arm, string> = {
  baseline: await Bun.file(join(DIR, "gen-system-baseline.md")).text(),
  treatment: await Bun.file(join(DIR, "gen-system-treatment.md")).text(),
};

function userMessage(s: Scenario): string {
  return [
    s.contextNote,
    "",
    `Title: ${s.title}`,
    "",
    "Diff:",
    "```diff",
    s.diff.trim(),
    "```",
    "",
    "Write the pull request description body in markdown. Output only the body, no preamble.",
  ].join("\n");
}

interface Usage {
  input: number;
  output: number;
}

const genUsage: Usage = { input: 0, output: 0 };
const judgeUsage: Usage = { input: 0, output: 0 };

let judgePromptCache: string | null = null;

// Judge wrapper that tracks token usage (judge.ts's judgeHeadings doesn't
// expose usage). Same model, batching, prompt, and schema as judge.ts.
async function judgeWithUsage(
  client: Anthropic,
  items: JudgeInput[],
): Promise<JudgeVerdict[]> {
  if (items.length === 0) return [];
  if (judgePromptCache === null) judgePromptCache = await loadPrompt();
  const verdicts: JudgeVerdict[] = [];
  for (let i = 0; i < items.length; i += HEADING_BATCH_SIZE) {
    const batch = items.slice(i, i + HEADING_BATCH_SIZE);
    const response = await client.messages.create({
      model: JUDGE_MODEL,
      max_tokens: 4096,
      temperature: 0,
      system: [{ type: "text", text: judgePromptCache, cache_control: { type: "ephemeral" } }],
      output_config: { format: { type: "json_schema", schema: verdictSchema() } },
      messages: [{ role: "user", content: renderBatch(batch) }],
    });
    judgeUsage.input += response.usage.input_tokens;
    judgeUsage.output += response.usage.output_tokens;
    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") {
      throw new Error(`Judge response had no text block (stop: ${response.stop_reason})`);
    }
    verdicts.push(...parseVerdicts(block.text, batch.map((b) => b.index)));
  }
  return verdicts;
}

async function generate(
  client: Anthropic,
  s: Scenario,
  arm: Arm,
): Promise<string> {
  const response = await client.messages.create({
    model: GEN_MODEL,
    max_tokens: 4096,
    temperature: 0,
    system: systemPrompts[arm],
    messages: [{ role: "user", content: userMessage(s) }],
  });
  genUsage.input += response.usage.input_tokens;
  genUsage.output += response.usage.output_tokens;
  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    throw new Error(`No text block for ${s.id} ${arm} (stop: ${response.stop_reason})`);
  }
  return block.text;
}

// --- Heading extraction (mirrors parse.ts normalization) ----------------------
interface ExtractedHeading {
  depth: number;
  text: string;
}

function extractHeadings(md: string): ExtractedHeading[] {
  const tokens = marked.lexer(md);
  const headings: ExtractedHeading[] = [];
  for (const t of tokens) {
    if (t.type === "heading") {
      headings.push({ depth: t.depth, text: t.text.replace(/\s+/g, " ").trim() });
    }
  }
  return headings;
}

// --- Parent + excerpt extraction from a generated body (mirrors judge-calibrate.ts)
const EXCERPT_LIMIT = 600;
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
}

// Find the nth occurrence (by depth+text match) so repeated headings align.
function extractContext(md: string, depth: number, text: string, occurrence: number): Context {
  const lines = md.split("\n");
  let seen = 0;
  for (let i = 0; i < lines.length; i++) {
    const lvl = headingLevel(lines[i]);
    if (lvl === null) continue;
    const htext = (headingTextOf(lines[i]) ?? "").replace(/\s+/g, " ").trim();
    if (lvl !== depth || htext !== text) continue;
    if (seen < occurrence) {
      seen++;
      continue;
    }
    let parent = "(top level)";
    for (let j = i - 1; j >= 0; j--) {
      const plvl = headingLevel(lines[j]);
      if (plvl !== null && plvl < lvl) {
        parent = (headingTextOf(lines[j]) ?? "(top level)").replace(/\s+/g, " ").trim();
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
    return { parent, excerpt };
  }
  return { parent: "(top level)", excerpt: "" };
}

interface GradedHeading {
  depth: number;
  text: string;
  classifierFlagged: boolean;
  classifierSignals: string[];
  judgeBad: boolean;
  judgeReason: string;
  judgeRewrite: string;
  combinedBad: boolean;
}

interface GradedBody {
  id: string;
  arm: Arm;
  category: string;
  expectSections: boolean;
  headings: GradedHeading[];
}

async function gradeBody(
  client: Anthropic,
  id: string,
  arm: Arm,
  category: string,
  expectSections: boolean,
  md: string,
): Promise<GradedBody> {
  const extracted = extractHeadings(md);

  // Build judge inputs with parent + excerpt from THIS body.
  const occCount = new Map<string, number>();
  const judgeInputs: JudgeInput[] = extracted.map((h, i) => {
    const key = `${h.depth}::${h.text}`;
    const occ = occCount.get(key) ?? 0;
    occCount.set(key, occ + 1);
    const ctx = extractContext(md, h.depth, h.text, occ);
    return { index: i, heading: h.text, parent: ctx.parent, excerpt: ctx.excerpt };
  });

  const verdicts = await judgeWithUsage(client, judgeInputs);
  const verdictByIndex = new Map(verdicts.map((v) => [v.index, v]));

  const headings: GradedHeading[] = extracted.map((h, i) => {
    const cls = classifyPrHeading(h.text);
    const v = verdictByIndex.get(i);
    const judgeBad = v?.bad ?? false;
    return {
      depth: h.depth,
      text: h.text,
      classifierFlagged: cls.flagged,
      classifierSignals: cls.signals,
      judgeBad,
      judgeReason: v?.reason ?? "",
      judgeRewrite: v?.rewrite ?? "",
      combinedBad: cls.flagged || judgeBad,
    };
  });

  return { id, arm, category, expectSections, headings };
}

async function main(): Promise<void> {
  const client = new Anthropic();
  const outDir = join(DIR, "gen-outputs");
  await mkdir(outDir, { recursive: true });

  // --- Generate (or reuse cached outputs) -----------------------------------
  const existing = new Set(await readdir(outDir).catch(() => []));
  for (const entry of index) {
    const s = await loadScenario(entry.id);
    for (const arm of ARMS) {
      const fname = `${s.id}.${arm}.md`;
      if (existing.has(fname)) {
        console.error(`skip (cached): ${fname}`);
        continue;
      }
      console.error(`generate: ${fname}`);
      const body = await generate(client, s, arm);
      await Bun.write(join(outDir, fname), body);
    }
  }

  // --- Grade ----------------------------------------------------------------
  const graded: GradedBody[] = [];
  for (const entry of index) {
    for (const arm of ARMS) {
      const md = await Bun.file(join(outDir, `${entry.id}.${arm}.md`)).text();
      console.error(`grade: ${entry.id}.${arm}`);
      graded.push(
        await gradeBody(client, entry.id, arm, entry.category, entry.expectSections, md),
      );
    }
  }

  await Bun.write(join(DIR, "gen-graded.json"), JSON.stringify(graded, null, 2));

  // --- Metrics --------------------------------------------------------------
  buildReport(graded);
}

function pct(n: number, d: number): string {
  if (d === 0) return "0.0%";
  return `${((n / d) * 100).toFixed(1)}%`;
}

interface ArmMetrics {
  total: number;
  classifierBad: number;
  judgeBad: number;
  combinedBad: number;
  falseSectionScenarios: number; // expectSections:false scenarios producing any ## heading
  smallHeadingTotal: number; // headings on the 6 expectSections:false scenarios
}

function armMetrics(graded: GradedBody[], arm: Arm): ArmMetrics {
  const bodies = graded.filter((g) => g.arm === arm);
  let total = 0;
  let classifierBad = 0;
  let judgeBad = 0;
  let combinedBad = 0;
  let falseSectionScenarios = 0;
  let smallHeadingTotal = 0;
  for (const b of bodies) {
    total += b.headings.length;
    for (const h of b.headings) {
      if (h.classifierFlagged) classifierBad++;
      if (h.judgeBad) judgeBad++;
      if (h.combinedBad) combinedBad++;
    }
    if (!b.expectSections) {
      const h2 = b.headings.filter((h) => h.depth === 2);
      if (h2.length > 0) falseSectionScenarios++;
      smallHeadingTotal += b.headings.length;
    }
  }
  return { total, classifierBad, judgeBad, combinedBad, falseSectionScenarios, smallHeadingTotal };
}

function buildReport(graded: GradedBody[]): void {
  const m: Record<Arm, ArmMetrics> = {
    baseline: armMetrics(graded, "baseline"),
    treatment: armMetrics(graded, "treatment"),
  };

  const lines: string[] = [];
  const p = (s = ""): void => {
    lines.push(s);
  };

  p("# PR Heading Generation A/B Eval");
  p();
  p(`Model: ${GEN_MODEL}, temperature 0. ${index.length} scenarios x 2 arms.`);
  p("Combined bad = classifier.flagged OR judge.bad.");
  p();

  // --- Headline -------------------------------------------------------------
  const baseRate = m.baseline.combinedBad / (m.baseline.total || 1);
  const treatRate = m.treatment.combinedBad / (m.treatment.total || 1);
  p("## Headline");
  p();
  p(`- Baseline combined bad-rate: ${m.baseline.combinedBad}/${m.baseline.total} = ${pct(m.baseline.combinedBad, m.baseline.total)}`);
  p(`- Treatment combined bad-rate: ${m.treatment.combinedBad}/${m.treatment.total} = ${pct(m.treatment.combinedBad, m.treatment.total)}`);
  p(`- Delta (treatment - baseline): ${((treatRate - baseRate) * 100).toFixed(1)} pp`);
  p(`- False-section scenarios (expectSections:false producing any \`##\`): baseline ${m.baseline.falseSectionScenarios}, treatment ${m.treatment.falseSectionScenarios} (delta ${m.treatment.falseSectionScenarios - m.baseline.falseSectionScenarios})`);
  p(`- Headings on the 6 small/borderline scenarios: baseline ${m.baseline.smallHeadingTotal}, treatment ${m.treatment.smallHeadingTotal}`);
  p();

  // --- Per-arm breakdown ----------------------------------------------------
  p("## Per-arm Breakdown");
  p();
  for (const arm of ARMS) {
    const a = m[arm];
    p(`### ${arm}`);
    p();
    p(`- Total headings produced: ${a.total}`);
    p(`- Classifier-only bad: ${a.classifierBad} (${pct(a.classifierBad, a.total)})`);
    p(`- Judge-only bad: ${a.judgeBad} (${pct(a.judgeBad, a.total)})`);
    p(`- Combined-OR bad: ${a.combinedBad} (${pct(a.combinedBad, a.total)})`);
    p(`- False-section scenarios: ${a.falseSectionScenarios} of 6`);
    p(`- Headings on small/borderline: ${a.smallHeadingTotal}`);
    p();
  }

  // --- Per-scenario table ---------------------------------------------------
  p("## Per-scenario");
  p();
  p("| id | category | base headings | base bad | treat headings | treat bad |");
  p("| --- | --- | --- | --- | --- | --- |");
  for (const entry of index) {
    const b = graded.find((g) => g.id === entry.id && g.arm === "baseline")!;
    const t = graded.find((g) => g.id === entry.id && g.arm === "treatment")!;
    const bb = b.headings.filter((h) => h.combinedBad).length;
    const tb = t.headings.filter((h) => h.combinedBad).length;
    p(`| ${entry.id} | ${entry.category} | ${b.headings.length} | ${bb} | ${t.headings.length} | ${tb} |`);
  }
  p();

  // --- Verbatim heading lists -----------------------------------------------
  p("## Verbatim Headings (good / BAD by combined-OR)");
  p();
  for (const entry of index) {
    p(`### ${entry.id} (${entry.category}, expectSections=${entry.expectSections})`);
    p();
    for (const arm of ARMS) {
      const b = graded.find((g) => g.id === entry.id && g.arm === arm)!;
      p(`**${arm}** (${b.headings.length} headings):`);
      p();
      if (b.headings.length === 0) {
        p("- (no headings)");
      } else {
        for (const h of b.headings) {
          const mark = h.combinedBad ? "BAD " : "good";
          const why: string[] = [];
          if (h.classifierFlagged) why.push(`cls: ${h.classifierSignals.join("; ")}`);
          if (h.judgeBad) why.push(`judge: ${h.judgeReason}${h.judgeRewrite ? ` -> ${h.judgeRewrite}` : ""}`);
          const suffix = why.length > 0 ? `  (${why.join(" | ")})` : "";
          p(`- [${mark}] ${"#".repeat(h.depth)} ${h.text}${suffix}`);
        }
      }
      p();
    }
  }

  // --- Cost -----------------------------------------------------------------
  // Total = generation + judge usage, both tracked directly from the SDK's
  // reported token counts. Sonnet pricing: $3/M input, $15/M output.
  const cost = (u: Usage): number => (u.input * 3 + u.output * 15) / 1_000_000;
  const genCost = cost(genUsage);
  const judgeCost = cost(judgeUsage);
  const totalIn = genUsage.input + judgeUsage.input;
  const totalOut = genUsage.output + judgeUsage.output;
  p("## Cost");
  p();
  p(`Generation: ${genUsage.input} input + ${genUsage.output} output = $${genCost.toFixed(4)}.`);
  p(`Judge: ${judgeUsage.input} input + ${judgeUsage.output} output = $${judgeCost.toFixed(4)}.`);
  p(`Total: ${totalIn} input + ${totalOut} output = $${(genCost + judgeCost).toFixed(4)} (sonnet $3/M in, $15/M out).`);
  p();

  Bun.write(join(DIR, "gen-eval-report.md"), lines.join("\n") + "\n");

  // Console summary
  console.log("\n=== SUMMARY ===");
  console.log(`Baseline combined bad-rate: ${pct(m.baseline.combinedBad, m.baseline.total)} (${m.baseline.combinedBad}/${m.baseline.total})`);
  console.log(`Treatment combined bad-rate: ${pct(m.treatment.combinedBad, m.treatment.total)} (${m.treatment.combinedBad}/${m.treatment.total})`);
  console.log(`Delta: ${((treatRate - baseRate) * 100).toFixed(1)} pp`);
  console.log(`False-section: baseline ${m.baseline.falseSectionScenarios}, treatment ${m.treatment.falseSectionScenarios} (delta ${m.treatment.falseSectionScenarios - m.baseline.falseSectionScenarios})`);
  console.log(`Total cost: $${(genCost + judgeCost).toFixed(4)} (gen $${genCost.toFixed(4)} + judge $${judgeCost.toFixed(4)})`);
}

await main();
