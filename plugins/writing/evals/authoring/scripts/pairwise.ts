#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { globSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { cli, command } from "cleye";
import seedrandom from "seedrandom";
import { mean } from "simple-statistics";
import { table } from "table";
import { z } from "zod";
import { decode, decodeFile, decodeJson } from "../../../../../packages/decode/index";
import { loadTags, traceReply } from "../../../../../evals/native/load";
import { Judgment, Key, Label, Pair, Pick, SURFACES, Surface } from "./pairs";

const OUT_TAG = /<out>([\s\S]*?)<\/out>/;

/** The final reply's `<out>...</out>` block, trimmed. */
export function extractOut(reply: string): string | undefined {
  return OUT_TAG.exec(reply)?.[1]?.trim();
}

const AssistantLine = z.object({
  type: z.literal("assistant"),
  message: z.object({ content: z.array(z.unknown()) }),
});
const ToolUseBlock = z.looseObject({
  type: z.literal("tool_use"),
  name: z.string(),
  input: z.unknown(),
});
const WriteInput = z.looseObject({ file_path: z.string(), content: z.string() });
const EditInput = z.looseObject({
  file_path: z.string(),
  old_string: z.string(),
  new_string: z.string(),
  replace_all: z.boolean().optional(),
});

/**
 * Replays every Write and Edit a trace made against `filePath`, in call order, and returns the
 * content that leaves. A Write replaces the whole file; an Edit applies a literal
 * old_string -> new_string substitution (first occurrence, unless `replace_all`) to the running
 * content. Undefined when the trace never wrote or edited that path.
 */
export function extractWrite(trace: string, filePath: string): string | undefined {
  let content: string | undefined;
  for (const raw of trace.trim().split("\n")) {
    if (raw.trim() === "") continue;
    const line = AssistantLine.safeParse(JSON.parse(raw));
    if (!line.success) continue;
    for (const block of line.data.message.content) {
      const use = ToolUseBlock.safeParse(block);
      if (!use.success) continue;
      if (use.data.name === "Write") {
        const input = WriteInput.safeParse(use.data.input);
        if (input.success && input.data.file_path === filePath) content = input.data.content;
      } else if (use.data.name === "Edit") {
        const input = EditInput.safeParse(use.data.input);
        if (input.success && input.data.file_path === filePath && content !== undefined) {
          content =
            input.data.replace_all === true
              ? content.split(input.data.old_string).join(input.data.new_string)
              : content.replace(input.data.old_string, input.data.new_string);
        }
      }
    }
  }
  return content;
}

/**
 * A run's deliverable text: the last Write/Edit content at `filePath` for a doc or skill brief,
 * or the final reply's `<out>` block otherwise. Doc and skill cases write a file because the
 * suite's `append_system_prompt` only stubs the network for the create-a-PR/issue path.
 */
export function extractDeliverable(trace: string, filePath?: string): string | undefined {
  if (filePath !== undefined) return extractWrite(trace, filePath);
  const reply = traceReply(trace);
  return reply === undefined ? undefined : extractOut(reply);
}

interface TraceFile {
  case: string;
  run: number;
  path: string;
}

function traceFiles(dir: string, arm: string): TraceFile[] {
  const pattern = new RegExp(`^(.+)-${arm}-(\\d+)\\.jsonl$`);
  return globSync(`traces/*-${arm}-*.jsonl`, { cwd: dir })
    .flatMap((file) => {
      const match = pattern.exec(basename(file));
      return match?.[1] === undefined || match[2] === undefined
        ? []
        : [{ case: match[1], run: Number(match[2]), path: join(dir, file) }];
    })
    .toSorted((a, b) => a.run - b.run);
}

/**
 * Every run's deliverable text on one arm, pooled across result paths in the order given and
 * grouped by case. `fileFor` names the file a case's deliverable is written to, or undefined to
 * extract the `<out>` block from the final reply instead.
 */
export async function collectDrafts(
  paths: string[],
  fileFor: (caseName: string) => string | undefined,
  arm = "with",
): Promise<Map<string, string[]>> {
  const byCase = new Map<string, string[]>();
  for (const path of paths) {
    const dir = path.endsWith(".json") ? dirname(path) : path;
    const files = traceFiles(dir, arm);
    // oxlint-disable-next-line no-await-in-loop -- one result directory's traces at a time, in the pooling order the caller gave.
    const read = await Promise.all(
      files.map(async (f) => [f.case, await Bun.file(f.path).text()] as const),
    );
    for (const [caseName, trace] of read) {
      const text = extractDeliverable(trace, fileFor(caseName));
      if (text === undefined) continue;
      const list = byCase.get(caseName) ?? [];
      list.push(text);
      byCase.set(caseName, list);
    }
  }
  return byCase;
}

/** Parses `case=value` flag entries into a lookup map. */
export function parseMap(entries: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of entries) {
    const split = entry.indexOf("=");
    if (split < 1) throw new Error(`expected case=value, got: ${entry}`);
    map.set(entry.slice(0, split), entry.slice(split + 1));
  }
  return map;
}

export function surfaceFor(
  caseName: string,
  tags: Map<string, string[]>,
  overrides: Map<string, string>,
): Surface {
  const override = overrides.get(caseName);
  if (override !== undefined) return Surface.parse(override);
  const found = (tags.get(caseName) ?? []).filter((t) =>
    (SURFACES as readonly string[]).includes(t),
  );
  const prefix = /^([a-z]+)-\d+$/.exec(caseName)?.[1];
  if (found.length === 0 && prefix !== undefined && Surface.safeParse(prefix).success) {
    return Surface.parse(prefix);
  }
  if (found.length !== 1) {
    throw new Error(
      `${caseName}: expected exactly one of ${SURFACES.join("/")} among its case.yaml tags, ` +
        `got [${(tags.get(caseName) ?? []).join(", ")}]. Pass --surface ${caseName}=<surface> to override.`,
    );
  }
  return Surface.parse(found[0]);
}

/**
 * The lines of `after` that a line diff against `before` marks as added, each hunk with
 * `context` unchanged lines on either side. Elided text between and around hunks is a `…` line.
 */
export function changedRegion(before: string, after: string, context = 3): string {
  const a = before.split("\n");
  const b = after.split("\n");
  const width = b.length + 1;
  const lcs = new Int32Array((a.length + 1) * width);
  const at = (i: number, j: number) => lcs[i * width + j] ?? 0;
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * width + j] =
        a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  const added = Array.from({ length: b.length }, () => false);
  let i = 0;
  let j = 0;
  while (j < b.length) {
    if (i < a.length && a[i] === b[j]) {
      i++;
      j++;
    } else if (i < a.length && at(i + 1, j) >= at(i, j + 1)) {
      i++;
    } else {
      added[j++] = true;
    }
  }
  const keep = added.map((_, k) =>
    added.slice(Math.max(0, k - context), k + context + 1).some(Boolean),
  );
  const out: string[] = [];
  for (const [k, line] of b.entries()) {
    if (keep[k]) out.push(line);
    else if (out.length > 0 && out.at(-1) !== "…") out.push("…");
    else if (out.length === 0 && k === 0) out.push("…");
  }
  if (!keep.some(Boolean)) return "";
  return out.join("\n");
}

async function trimToChange(beforeDir: string | undefined, caseName: string, texts: string[]) {
  if (beforeDir === undefined) return texts;
  const file = Bun.file(join(beforeDir, `${caseName}.md`));
  if (!(await file.exists())) return texts;
  const before = await file.text();
  return texts.map((t) => changedRegion(before, t));
}

async function briefFor(suite: string, caseName: string): Promise<string> {
  return (await Bun.file(join(suite, caseName, "prompt.md")).text()).trim();
}

const OriginalRecord = z.looseObject({ url: z.string() });

interface PairsFlags {
  suite: string | undefined;
  base: string | undefined;
  candidate: string | undefined;
  original: string | undefined;
  field: string;
  out: string | undefined;
  file: string[];
  surface: string[];
  before?: string | undefined;
  baseArm?: string | undefined;
  candidateArm?: string | undefined;
  baseLabel: string;
  candidateLabel: string;
}

export async function buildPairs(flags: PairsFlags): Promise<Pair[]> {
  if (flags.suite === undefined) throw new Error("--suite is required");
  if (flags.candidate === undefined) throw new Error("--candidate is required");
  if (flags.original !== undefined && flags.base !== undefined) {
    throw new Error("--original and --base are mutually exclusive");
  }
  if (flags.original === undefined && flags.base === undefined) {
    throw new Error("one of --base or --original is required");
  }

  const fileOverrides = parseMap(flags.file);
  const surfaceOverrides = parseMap(flags.surface);
  const tags = await loadTags(flags.suite);
  const candidateArm = flags.candidateArm ?? "with";
  const baseArm = flags.baseArm ?? "with";
  const candidateDrafts = await collectDrafts(
    flags.candidate.split(","),
    (c) => fileOverrides.get(c),
    candidateArm,
  );
  for (const [caseName, texts] of candidateDrafts) {
    // oxlint-disable-next-line no-await-in-loop -- one case's before file read at a time.
    candidateDrafts.set(caseName, await trimToChange(flags.before, caseName, texts));
  }

  const pairs: Pair[] = [];
  if (flags.original !== undefined) {
    const originalDir = flags.original;
    for (const [caseName, texts] of candidateDrafts) {
      const recordPath = join(originalDir, `${caseName}.json`);
      // oxlint-disable-next-line no-await-in-loop -- one case's original checked at a time, in case order.
      if (!(await Bun.file(recordPath).exists())) {
        console.error(`skip ${caseName}: no original`);
        continue;
      }
      // oxlint-disable-next-line no-await-in-loop -- one case's original text read at a time, in case order.
      const record = await decodeFile(OriginalRecord, recordPath);
      const raw = decode(z.string(), record[flags.field], `${caseName}.json field ${flags.field}`);
      // oxlint-disable-next-line no-await-in-loop -- one case's before file read at a time.
      const [text = raw] = await trimToChange(flags.before, caseName, [raw]);
      const surface = surfaceFor(caseName, tags, surfaceOverrides);
      // oxlint-disable-next-line no-await-in-loop -- one case's prompt.md read at a time, in case order.
      const brief = await briefFor(flags.suite, caseName);
      for (const [run, candidateText] of texts.entries()) {
        pairs.push({
          id: `${caseName}-original-${flags.candidateLabel}-${run}`,
          case: caseName,
          surface,
          brief,
          a: { source: { kind: "original", url: record.url }, text },
          b: {
            source: { kind: "run", column: flags.candidateLabel, arm: candidateArm, run },
            text: candidateText,
          },
        });
      }
    }
    return pairs;
  }

  if (flags.base === undefined) throw new Error("one of --base or --original is required");
  const baseDrafts = await collectDrafts(
    flags.base.split(","),
    (c) => fileOverrides.get(c),
    baseArm,
  );
  for (const [caseName, texts] of baseDrafts) {
    // oxlint-disable-next-line no-await-in-loop -- one case's before file read at a time.
    baseDrafts.set(caseName, await trimToChange(flags.before, caseName, texts));
  }
  for (const [caseName, candidateTexts] of candidateDrafts) {
    const baseTexts = baseDrafts.get(caseName);
    if (baseTexts === undefined) {
      console.error(`skip ${caseName}: no base drafts`);
      continue;
    }
    const surface = surfaceFor(caseName, tags, surfaceOverrides);
    // oxlint-disable-next-line no-await-in-loop -- one case's prompt.md read at a time, in case order.
    const brief = await briefFor(flags.suite, caseName);
    if (baseTexts.length !== candidateTexts.length) {
      console.error(
        `${caseName}: pairing ${Math.min(baseTexts.length, candidateTexts.length)} of ` +
          `${baseTexts.length} ${flags.baseLabel} / ${candidateTexts.length} ${flags.candidateLabel} runs`,
      );
    }
    for (const [run, base] of baseTexts.entries()) {
      const candidate = candidateTexts[run];
      if (candidate === undefined) break;
      pairs.push({
        id: `${caseName}-${flags.baseLabel}-${flags.candidateLabel}-${run}`,
        case: caseName,
        surface,
        brief,
        a: { source: { kind: "run", column: flags.baseLabel, arm: baseArm, run }, text: base },
        b: {
          source: { kind: "run", column: flags.candidateLabel, arm: candidateArm, run },
          text: candidate,
        },
      });
    }
  }
  return pairs;
}

async function writePairs(pairs: Pair[], out: string): Promise<void> {
  await mkdir(out, { recursive: true });
  await Promise.all(
    pairs.map((pair) =>
      Bun.write(join(out, `${pair.id}.json`), `${JSON.stringify(pair, null, 2)}\n`),
    ),
  );
}

/** Which key sits on the left ("1") slot of the judge prompt. */
export function blind(flip: boolean): Key {
  return flip ? "b" : "a";
}

export function renderJudgePrompt(template: string, pair: Pair, left: Key): string {
  const right: Key = left === "a" ? "b" : "a";
  return template
    .replaceAll("{{brief}}", pair.brief)
    .replaceAll("{{left}}", pair[left].text)
    .replaceAll("{{right}}", pair[right].text);
}

export function deblindPick(raw: "1" | "2" | "tie", left: Key): Pick {
  if (raw === "tie") return "tie";
  const right: Key = left === "a" ? "b" : "a";
  return raw === "1" ? left : right;
}

const JudgeReply = z.object({ reason: z.string(), pick: z.enum(["1", "2", "tie"]) });
export type JudgeReply = z.infer<typeof JudgeReply>;

export type ModelCall = (prompt: string, model: string) => Promise<JudgeReply>;

function judgeReplySchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      reason: { type: "string" },
      pick: { type: "string", enum: ["1", "2", "tie"] },
    },
    required: ["reason", "pick"],
    additionalProperties: false,
  };
}

async function callModel(prompt: string, model: string): Promise<JudgeReply> {
  for await (const message of query({
    prompt,
    options: {
      model,
      // Structured output lands through a tool call, which takes a second turn.
      maxTurns: 3,
      tools: [],
      settingSources: [],
      mcpServers: {},
      strictMcpConfig: true,
      outputFormat: { type: "json_schema", schema: judgeReplySchema() },
    },
  })) {
    if (message.type !== "result") continue;
    if (message.subtype !== "success") throw new Error(`judge call failed: ${message.subtype}`);
    return message.structured_output !== undefined
      ? decode(JudgeReply, message.structured_output, "judge reply")
      : decodeJson(JudgeReply, message.result, "judge reply");
  }
  throw new Error("judge call produced no result message");
}

/**
 * Judges one pair. `--swap` judges it in both slot orders and records a tie when the two
 * verdicts disagree, since a judge that flips its pick with the draft's position is not a
 * reliable signal either way.
 */
export async function judgePair(
  pair: Pair,
  template: string,
  promptHash: string,
  model: string,
  swap: boolean,
  call: ModelCall,
  rng: () => number = Math.random,
): Promise<Judgment> {
  const left = blind(rng() < 0.5);
  const primary = await call(renderJudgePrompt(template, pair, left), model);
  let pick = deblindPick(primary.pick, left);
  let reason = primary.reason;

  if (swap) {
    const swappedLeft: Key = left === "a" ? "b" : "a";
    const secondary = await call(renderJudgePrompt(template, pair, swappedLeft), model);
    const swappedPick = deblindPick(secondary.pick, swappedLeft);
    if (swappedPick !== pick) {
      reason = `swap disagreement (${pick} then ${swappedPick}): ${reason} / ${secondary.reason}`;
      pick = "tie";
    }
  }

  return { id: pair.id, pick, left, reason, prompt: promptHash, model };
}

/** A Judgment on disk from a previous run of the same prompt is worth keeping as-is. */
export function isFresh(existing: Judgment | undefined, promptHash: string): existing is Judgment {
  return existing?.prompt === promptHash;
}

/** Runs `fn` over `items` in batches of `concurrency`, each batch fully parallel. */
export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const size = Math.max(1, concurrency);
  const results: R[] = [];
  for (let start = 0; start < items.length; start += size) {
    const batch = items.slice(start, start + size);
    // oxlint-disable-next-line no-await-in-loop -- batches run sequentially; each batch itself runs in parallel, bounding concurrency to `size`.
    const batchResults = await Promise.all(batch.map((item, i) => fn(item, start + i)));
    results.push(...batchResults);
  }
  return results;
}

function listJson(dir: string): string[] {
  return globSync("*.json", { cwd: dir }).toSorted();
}

async function readAll<S extends z.ZodType>(schema: S, dir: string): Promise<z.output<S>[]> {
  return Promise.all(listJson(dir).map((f) => decodeFile(schema, join(dir, f))));
}

interface JudgeFlags {
  pairs: string | undefined;
  out: string | undefined;
  swap: boolean;
  model: string;
  prompt: string;
  concurrency: number;
}

async function judgeMain(flags: JudgeFlags): Promise<void> {
  const pairsDir = flags.pairs;
  const outDir = flags.out;
  if (pairsDir === undefined || outDir === undefined) {
    throw new Error("--pairs and --out are required");
  }
  const template = await Bun.file(flags.prompt).text();
  const promptHash = createHash("sha256").update(template).digest("hex").slice(0, 12);
  const pairs = await readAll(Pair, pairsDir);
  await mkdir(outDir, { recursive: true });

  let fresh = 0;
  await mapPool(pairs, flags.concurrency, async (pair) => {
    const outPath = join(outDir, `${pair.id}.json`);
    const existing = (await Bun.file(outPath).exists())
      ? await decodeFile(Judgment, outPath)
      : undefined;
    if (isFresh(existing, promptHash)) return existing;

    const judgment = await judgePair(
      pair,
      template,
      promptHash,
      flags.model,
      flags.swap,
      callModel,
    );
    await Bun.write(outPath, `${JSON.stringify(judgment, null, 2)}\n`);
    fresh++;
    console.error(`[${fresh}] ${pair.id}: ${judgment.pick}`);
    return judgment;
  });

  console.log(`judged ${pairs.length} pairs (${fresh} freshly called) in ${outDir}`);
}

/** 0 for a, 1 for b, 0.5 for a tie: candidate b's win credit against base a. */
export function winValue(pick: Pick): number {
  if (pick === "tie") return 0.5;
  return pick === "b" ? 1 : 0;
}

/**
 * Two-sided sign-flip permutation p-value for a win rate against the no-preference null of 0.5.
 * Ties always flip to themselves, so they carry no evidence either way. Deterministic under a
 * seeded `rng`.
 */
export function signFlipPValue(
  wins: readonly number[],
  trials = 10_000,
  rng: () => number = Math.random,
): number {
  const decided = wins.filter((w) => w !== 0.5);
  if (decided.length === 0) return Number.NaN;
  const observed = Math.abs(mean(wins) - 0.5);
  let extreme = 0;
  for (let t = 0; t < trials; t++) {
    let sum = 0;
    for (const w of wins) {
      if (w === 0.5) {
        sum += 0.5;
      } else {
        sum += rng() < 0.5 ? w : 1 - w;
      }
    }
    if (Math.abs(sum / wins.length - 0.5) >= observed - 1e-9) extreme++;
  }
  return extreme / trials;
}

/** Share of non-tie picks that landed on the left ("1") slot, a position-bias indicator. */
export function leftPickShare(judgments: readonly Judgment[]): number {
  const decided = judgments.filter((j) => j.pick !== "tie");
  if (decided.length === 0) return Number.NaN;
  return mean(decided.map((j) => (j.pick === j.left ? 1 : 0)));
}

export interface CaseScore {
  case: string;
  n: number;
  winRate: number;
  p: number;
}

export interface ScoreReport {
  cases: CaseScore[];
  overall: CaseScore;
  leftPickShare: number;
}

export function scoreJudgments(
  pairs: Pair[],
  judgments: Judgment[],
  seed = "pairwise",
): ScoreReport {
  const caseOf = new Map(pairs.map((p) => [p.id, p.case]));
  const byCase = new Map<string, Judgment[]>();
  for (const j of judgments) {
    const caseName = caseOf.get(j.id);
    if (caseName === undefined) continue;
    const list = byCase.get(caseName) ?? [];
    list.push(j);
    byCase.set(caseName, list);
  }

  const rng = seedrandom(seed);
  const scoreOf = (name: string, js: Judgment[]): CaseScore => {
    const wins = js.map((j) => winValue(j.pick));
    return {
      case: name,
      n: js.length,
      winRate: wins.length > 0 ? mean(wins) : Number.NaN,
      p: signFlipPValue(wins, 10_000, rng),
    };
  };

  const cases = [...byCase.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([name, js]) => scoreOf(name, js));
  const matched = judgments.filter((j) => caseOf.has(j.id));
  return { cases, overall: scoreOf("overall", matched), leftPickShare: leftPickShare(matched) };
}

function pct(x: number): string {
  return Number.isNaN(x) ? "-" : `${(x * 100).toFixed(0)}%`;
}

export function formatScore(report: ScoreReport, alpha: number): string {
  const rows = [...report.cases, report.overall].map((c) => {
    const starred = !Number.isNaN(c.p) && c.p < alpha;
    return [
      c.case,
      String(c.n),
      pct(c.winRate),
      Number.isNaN(c.p) ? "-" : `${c.p.toFixed(3)}${starred ? "*" : ""}`,
    ];
  });
  return [
    `* marks p < ${alpha} against a 0.5 win rate for the candidate (sign-flip permutation test)`,
    table([["case", "n", "win rate (b)", "p"], ...rows]),
    `left-slot pick share (position bias): ${pct(report.leftPickShare)}`,
  ].join("\n");
}

interface ScoreFlags {
  judgments: string | undefined;
  pairs: string | undefined;
  alpha: number;
}

async function scoreMain(flags: ScoreFlags): Promise<void> {
  if (flags.judgments === undefined || flags.pairs === undefined) {
    throw new Error("--judgments and --pairs are required");
  }
  const [judgments, pairs] = await Promise.all([
    readAll(Judgment, flags.judgments),
    readAll(Pair, flags.pairs),
  ]);
  console.log(formatScore(scoreJudgments(pairs, judgments), flags.alpha));
}

/** Wilson score interval for a proportion. */
export function wilson(hits: number, total: number, zScore = 1.96): [number, number] {
  if (total === 0) return [0, 1];
  const p = hits / total;
  const denominator = 1 + (zScore * zScore) / total;
  const center = (p + (zScore * zScore) / (2 * total)) / denominator;
  const spread =
    (zScore / denominator) *
    Math.sqrt((p * (1 - p)) / total + (zScore * zScore) / (4 * total * total));
  return [Math.max(0, center - spread), Math.min(1, center + spread)];
}

export interface Comparison {
  id: string;
  surface: string;
  tie: boolean;
  agree: boolean;
}

/** Ties on either side never count as agreement. */
export function compareLabels(
  labels: Label[],
  judgments: Judgment[],
  surfaces: Map<string, string>,
): Comparison[] {
  const judgmentById = new Map(judgments.map((j) => [j.id, j]));
  return labels.flatMap((label) => {
    const judgment = judgmentById.get(label.id);
    if (judgment === undefined) return [];
    const tie = label.pick === "tie" || judgment.pick === "tie";
    return [
      {
        id: label.id,
        surface: surfaces.get(label.id) ?? "unknown",
        tie,
        agree: !tie && label.pick === judgment.pick,
      },
    ];
  });
}

export interface Agreement {
  n: number;
  ties: number;
  agree: number;
  decided: number;
  rate: number;
  lo: number;
  hi: number;
}

export function agreementOf(comparisons: readonly Comparison[]): Agreement {
  const ties = comparisons.filter((c) => c.tie).length;
  const decided = comparisons.filter((c) => !c.tie);
  const agree = decided.filter((c) => c.agree).length;
  const [lo, hi] = wilson(agree, decided.length);
  return {
    n: comparisons.length,
    ties,
    agree,
    decided: decided.length,
    rate: decided.length > 0 ? agree / decided.length : Number.NaN,
    lo,
    hi,
  };
}

export interface CalibrationReport {
  overall: Agreement;
  bySurface: [surface: string, agreement: Agreement][];
}

export function calibrate(comparisons: readonly Comparison[]): CalibrationReport {
  const surfaces = [...new Set(comparisons.map((c) => c.surface))].toSorted();
  return {
    overall: agreementOf(comparisons),
    bySurface: surfaces.map((s) => [s, agreementOf(comparisons.filter((c) => c.surface === s))]),
  };
}

export function formatCalibration(report: CalibrationReport, threshold: number): string {
  const row = (label: string, a: Agreement): string[] => [
    label,
    String(a.decided),
    String(a.ties),
    pct(a.rate),
    `${pct(a.lo)} - ${pct(a.hi)}`,
    !Number.isNaN(a.rate) && a.rate >= threshold ? "pass" : "fail",
  ];
  const rows = [
    ...report.bySurface.map(([surface, a]) => row(surface, a)),
    row("overall", report.overall),
  ];
  return [
    `agreement excludes pairs either side called a tie (reported as ties); pass requires >= ${pct(threshold)}`,
    table([["surface", "decided", "ties", "agreement", "95% interval", "verdict"], ...rows]),
  ].join("\n");
}

interface CalibrateFlags {
  labels: string | undefined;
  judgments: string | undefined;
  pairs: string | undefined;
  threshold: number;
}

async function calibrateMain(flags: CalibrateFlags): Promise<void> {
  if (flags.labels === undefined || flags.judgments === undefined) {
    throw new Error("--labels and --judgments are required");
  }
  const [labels, judgments] = await Promise.all([
    readAll(Label, flags.labels),
    readAll(Judgment, flags.judgments),
  ]);
  const surfaces = new Map<string, string>();
  if (flags.pairs !== undefined) {
    for (const pair of await readAll(Pair, flags.pairs)) surfaces.set(pair.id, pair.surface);
  }
  const report = calibrate(compareLabels(labels, judgments, surfaces));
  console.log(formatCalibration(report, flags.threshold));
  if (Number.isNaN(report.overall.rate) || report.overall.rate < flags.threshold) process.exit(1);
}

if (import.meta.main) {
  const pairsCmd = command(
    {
      name: "pairs",
      help: {
        description:
          "Pair a base column's drafts with a candidate column's drafts (or with Ben's originals), run-for-run, and write Pair JSON files",
      },
      flags: {
        suite: {
          type: String,
          description: "Suite directory holding each case's prompt.md and case.yaml tags",
        },
        base: {
          type: String,
          description: "Comma-separated aggregate-result.json paths for the base column",
        },
        candidate: {
          type: String,
          description: "Comma-separated aggregate-result.json paths for the candidate column",
        },
        original: {
          type: String,
          description:
            "Directory of <case>.json files holding Ben's original text, paired against --candidate instead of --base",
        },
        field: {
          type: String,
          default: "original",
          description: "Field in <case>.json holding the original text",
        },
        out: { type: String, description: "Directory to write Pair JSON files" },
        file: {
          type: [String],
          default: [],
          description:
            "case=path override: extract the deliverable from the last Write/Edit to this file instead of the reply's <out> block",
        },
        surface: {
          type: [String],
          default: [],
          description: "case=surface override when the suite's case.yaml tags do not name one",
        },
        before: {
          type: String,
          description:
            "Directory of <case>.md files holding a deliverable file's pre-change contents; drafts for those cases are trimmed to the changed region",
        },
        baseArm: { type: String, default: "with", description: "Arm the base drafts come from" },
        candidateArm: {
          type: String,
          default: "with",
          description: "Arm the candidate drafts come from",
        },
        baseLabel: {
          type: String,
          default: "base",
          description: "Source.column label for the base drafts",
        },
        candidateLabel: {
          type: String,
          default: "candidate",
          description: "Source.column label for the candidate drafts",
        },
      },
    },
    async (parsed) => {
      const pairs = await buildPairs(parsed.flags);
      if (parsed.flags.out === undefined) throw new Error("--out is required");
      await writePairs(pairs, parsed.flags.out);
      console.log(`wrote ${pairs.length} pairs to ${parsed.flags.out}`);
    },
  );

  const judgeCmd = command(
    {
      name: "judge",
      help: {
        description:
          "Blind-judge each pair with the Claude Agent SDK on subscription auth, de-blind the verdict, and write resumable Judgment files",
      },
      flags: {
        pairs: { type: String, description: "Directory of Pair JSON files" },
        out: { type: String, description: "Directory to write Judgment JSON files" },
        swap: {
          type: Boolean,
          default: false,
          description: "Judge both slot orders; disagreement records a tie",
        },
        model: { type: String, default: "claude-sonnet-5", description: "Judge model" },
        prompt: {
          type: String,
          default: join(import.meta.dirname, "judge-prompt.md"),
          description: "Judge prompt template",
        },
        concurrency: { type: Number, default: 4, description: "Judge calls in flight" },
      },
    },
    async (parsed) => {
      await judgeMain(parsed.flags);
    },
  );

  const scoreCmd = command(
    {
      name: "score",
      help: {
        description:
          "Report candidate win rate vs base (ties = 0.5) per case and overall, with a sign-flip permutation p-value and position bias",
      },
      flags: {
        judgments: { type: String, description: "Directory of Judgment JSON files" },
        pairs: { type: String, description: "Directory of Pair JSON files" },
        alpha: { type: Number, default: 0.1, description: "Star a p-value below this" },
      },
    },
    async (parsed) => {
      await scoreMain(parsed.flags);
    },
  );

  const calibrateCmd = command(
    {
      name: "calibrate",
      help: {
        description:
          "Score agreement between Ben's Labels and the judge's Judgments, overall and per surface, and fail below --threshold",
      },
      flags: {
        labels: { type: String, description: "Directory of Label JSON files" },
        judgments: { type: String, description: "Directory of Judgment JSON files" },
        pairs: {
          type: String,
          description: "Directory of Pair JSON files, for the per-surface breakdown",
        },
        threshold: { type: Number, default: 0.75, description: "Minimum agreement rate to pass" },
      },
    },
    async (parsed) => {
      await calibrateMain(parsed.flags);
    },
  );

  await cli(
    {
      name: "pairwise",
      help: {
        description: "Build, judge, and score blind pairwise comparisons for the authoring suite",
      },
      commands: [pairsCmd, judgeCmd, scoreCmd, calibrateCmd],
    },
    (parsed) => {
      parsed.showHelp();
    },
  );
}
