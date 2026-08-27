import { createHash } from "node:crypto";
import * as path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { DeliverableRow } from "./dump";

/**
 * Meaning-layer LLM judge (issue #791). Batch-only: this module is imported by
 * the analyze skill's scripts and the judge runner, never by hooks. Hooks stay
 * deterministic; the wall is the same one that keeps tagger adapters out of
 * `hooks/` (see linguistics.md "Modules").
 *
 * The rule is the prompt: `resources/judge/prompt.md` is a committed, versioned
 * artifact. Every audit and every reproducibility tuple records its sha256, so
 * a prompt edit invalidates prior numbers (judge-fixtures.ts pins the hash and
 * fails CI until the tuples are re-validated).
 */

export const JUDGE_MODEL = "claude-haiku-4-5";
export const CHUNK_WORD_LIMIT = 1500;
export const MAX_SAMPLE_SPANS = 5;

export const PROMPT_PATH = path.join(import.meta.dirname, "..", "resources", "judge", "prompt.md");
export const HEADING_PROMPT_PATH = path.join(
  import.meta.dirname,
  "..",
  "resources",
  "judge",
  "headings-prompt.md",
);

export type CriterionKey =
  | "information_density"
  | "motivation_presence"
  | "marketing_phrasing"
  | "hedging_density"
  | "sycophancy"
  | "press_release_structure";

export interface JudgeCriterion {
  /** Report identifier (kebab-case). */
  id: string;
  /** JSON key in the judge's structured output. */
  key: CriterionKey;
  layer: "meaning";
  /** The rubric question, summarized for reports. */
  question: string;
  /** What evidence earned this criterion its place (curation principle). */
  evidence: string;
  /** What corpus condition retires it. */
  retire: string;
}

/**
 * Rubric order is load-bearing: it drives prompt position, report ordering,
 * and calibration attention. information-density leads (the user-ranked top
 * complaint on the PR surface); press-release-structure is kept but last
 * (structure is partly skill-governed, and content vacuity outranks format
 * uniformity).
 */
export const JUDGE_CRITERIA: readonly JudgeCriterion[] = [
  {
    id: "information-density",
    key: "information_density",
    layer: "meaning",
    question:
      "Given that the reviewer has the diff, does this text tell them anything they could not see for themselves?",
    evidence:
      "Vacuous specificity is the user-ranked top complaint on the PR surface (#791 comment): diff restatement, counts, and value-without-mechanism persist past the deterministic test-result detector and the pull-request skill's section bans.",
    retire:
      "Two consecutive calibration windows where the flag rate on the deliverable corpus falls below every other criterion, or a deterministic precursor that covers the unbounded remainder.",
  },
  {
    id: "motivation-presence",
    key: "motivation_presence",
    layer: "meaning",
    question: "Does the body say why the change was needed, or only what changed?",
    evidence:
      "Baseline comparison (#789): 42% of pre-AI PRs explain motivation vs 32% AI-era. The one voice feature no rate metric captures.",
    retire:
      "Motivation-presence rates converge between judged model output and the voice baseline across two calibration windows.",
  },
  {
    id: "marketing-phrasing",
    key: "marketing_phrasing",
    layer: "meaning",
    question: "Does the text sell the change instead of describing it?",
    evidence:
      "Named judge territory in linguistics.md: marketing tone has no grammar, and the marketing-verbs wordlist only catches the vocabulary fraction.",
    retire:
      "The wordlist audit shows the vocabulary layer already catches the surviving instances (judge flags add no documents beyond wordlist hits).",
  },
  {
    id: "hedging-density",
    key: "hedging_density",
    layer: "meaning",
    question: "Is the text padded with stacked qualifiers that avoid committing to a claim?",
    evidence:
      "soft-phrasing.txt covers individual hedges; density across a document is a meaning-layer property no weighted threshold expresses (linguistics.md).",
    retire:
      "The weighted soft-phrasing group reaches parity: judge flags add no documents beyond the deterministic group's threshold hits.",
  },
  {
    id: "sycophancy",
    key: "sycophancy",
    layer: "meaning",
    question: "Does the text flatter the reader or perform agreement?",
    evidence:
      "Sycophantic openers are chat-surface wordlist rules; deliverable-surface flattery (review replies, PR comments) has no deterministic detector.",
    retire:
      "Flag rate on the deliverable corpus drops to the voice-baseline rate for two calibration windows.",
  },
  {
    id: "press-release-structure",
    key: "press_release_structure",
    layer: "meaning",
    question: "Is the document organized like a product announcement rather than working prose?",
    evidence:
      "Kept from the issue body's original rubric, ranked last per the #788 provenance comment: structure is partly skill-governed and content vacuity outranks format uniformity.",
    retire:
      "Two calibration rounds where flags are dominated by skill-governed template structure rather than content, or the criterion's spans duplicate information-density flags.",
  },
];

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export interface VersionedPrompt {
  text: string;
  sha256: string;
}

export async function loadPrompt(promptPath: string = PROMPT_PATH): Promise<VersionedPrompt> {
  const text = await Bun.file(promptPath).text();
  return { text, sha256: sha256(text) };
}

export interface CriterionVerdict {
  flagged: boolean;
  span: string | null;
}

export type JudgeVerdict = Record<CriterionKey, CriterionVerdict>;

/** JSON schema for the judge's structured output (one object per chunk). */
export function verdictSchema(): Record<string, unknown> {
  const criterion = {
    type: "object",
    properties: {
      flagged: { type: "boolean" },
      // anyOf rather than type: ["string", "null"]: the structured-outputs
      // schema subset documents anyOf support; type arrays are not listed.
      span: { anyOf: [{ type: "string" }, { type: "null" }] },
    },
    required: ["flagged", "span"],
    additionalProperties: false,
  };
  const properties: Record<string, unknown> = {};
  for (const c of JUDGE_CRITERIA) properties[c.key] = criterion;
  return {
    type: "object",
    properties,
    required: JUDGE_CRITERIA.map((c) => c.key),
    additionalProperties: false,
  };
}

export function parseVerdict(json: string): JudgeVerdict {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(`Judge returned invalid JSON: ${(error as Error).message}`, { cause: error });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Judge verdict must be a JSON object");
  }
  const record = parsed as Record<string, unknown>;
  const verdict = {} as JudgeVerdict;
  for (const criterion of JUDGE_CRITERIA) {
    const value = record[criterion.key];
    if (typeof value !== "object" || value === null) {
      throw new Error(`Judge verdict missing criterion "${criterion.key}"`);
    }
    const entry = value as Record<string, unknown>;
    if (typeof entry.flagged !== "boolean") {
      throw new Error(`Judge verdict "${criterion.key}.flagged" must be a boolean`);
    }
    if (entry.span !== null && typeof entry.span !== "string") {
      throw new Error(`Judge verdict "${criterion.key}.span" must be a string or null`);
    }
    verdict[criterion.key] = { flagged: entry.flagged, span: entry.span };
  }
  return verdict;
}

export function countWords(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length;
}

/**
 * Split a document over the word limit at paragraph boundaries. A single
 * paragraph longer than the limit stays whole rather than splitting
 * mid-paragraph, since the judge reads sentences in context.
 */
export function chunkDocument(text: string, wordLimit: number = CHUNK_WORD_LIMIT): string[] {
  if (countWords(text) <= wordLimit) return [text];
  const paragraphs = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let current: string[] = [];
  let currentWords = 0;
  for (const paragraph of paragraphs) {
    const words = countWords(paragraph);
    if (words === 0) continue;
    if (current.length > 0 && currentWords + words > wordLimit) {
      chunks.push(current.join("\n\n"));
      current = [];
      currentWords = 0;
    }
    current.push(paragraph);
    currentWords += words;
  }
  if (current.length > 0) chunks.push(current.join("\n\n"));
  return chunks;
}

/**
 * Per-criterion maxima across chunks: a document is flagged on a criterion
 * when any chunk is, and carries the first flagged chunk's span.
 */
export function aggregateVerdicts(verdicts: JudgeVerdict[]): JudgeVerdict {
  if (verdicts.length === 0) throw new Error("aggregateVerdicts requires at least one verdict");
  const aggregate = {} as JudgeVerdict;
  for (const criterion of JUDGE_CRITERIA) {
    const flagged = verdicts.filter((v) => v[criterion.key].flagged);
    aggregate[criterion.key] = {
      flagged: flagged.length > 0,
      span: flagged.find((v) => v[criterion.key].span !== null)?.[criterion.key].span ?? null,
    };
  }
  return aggregate;
}

/** Judges one chunk of text. The seam tests mock; the SDK call implements. */
export type ChunkJudge = (chunkText: string) => Promise<JudgeVerdict>;

export interface AnthropicJudgeOptions {
  prompt: string;
  model?: string;
}

/**
 * Real judge over the Messages API: temperature 0, structured JSON output,
 * prompt cached as a stable system prefix so repeated calls share it.
 */
export function anthropicChunkJudge(options: AnthropicJudgeOptions): ChunkJudge {
  const client = new Anthropic();
  const model = options.model ?? JUDGE_MODEL;
  return async (chunkText: string) => {
    const response = await client.messages.create({
      model,
      max_tokens: 2048,
      temperature: 0,
      system: [{ type: "text", text: options.prompt, cache_control: { type: "ephemeral" } }],
      output_config: { format: { type: "json_schema", schema: verdictSchema() } },
      messages: [{ role: "user", content: chunkText }],
    });
    const block = response.content.find((b) => b.type === "text");
    if (!block) {
      throw new Error(`Judge response contained no text block (stop: ${response.stop_reason})`);
    }
    return parseVerdict(block.text);
  };
}

export async function judgeDocument(judge: ChunkJudge, text: string): Promise<JudgeVerdict> {
  const chunks = chunkDocument(text);
  const verdicts: JudgeVerdict[] = [];
  for (const chunk of chunks) {
    verdicts.push(await judge(chunk));
  }
  return aggregateVerdicts(verdicts);
}

interface ModelPricing {
  input: number;
  output: number;
}

const HAIKU_PRICING: ModelPricing = { input: 1, output: 5 };

/**
 * Per-MTok USD rates matched by family substring, so a new model id in a known
 * family needs no edit here. The family rows mirror `model_input_rate` and
 * `model_output_rate` in
 * `plugins/claude-code/skills/session/resources/schema/03_macros.sql`. Plugins
 * cannot import across plugin boundaries, so a rate change has to touch both.
 * Sonnet is held at the 3/15 standard rate rather than a promotional rate, since
 * an estimate for a known family must not come in under the real bill.
 *
 * The no-match fallback in `modelPricing` is the one place the two deliberately
 * diverge. The SQL defaults an unknown model to Opus rates, this defaults to
 * Haiku and warns. Raising that floor is a behavioral change, not a rate sync.
 */
const FAMILY_PRICING: ReadonlyArray<readonly [string, ModelPricing]> = [
  ["fable", { input: 10, output: 50 }],
  ["mythos", { input: 10, output: 50 }],
  ["opus", { input: 5, output: 25 }],
  ["sonnet", { input: 3, output: 15 }],
  ["haiku", HAIKU_PRICING],
];

/** Rough tokens-per-word multiplier for the offline fallback estimate. */
const TOKENS_PER_WORD = 1.35;
/** Structured verdict with spans lands well under this output budget. */
const OUTPUT_TOKENS_PER_CALL = 300;
/** count_tokens is free but rate-limited, so counting calls run in a small pool. */
const COUNT_CONCURRENCY = 8;

/** Counts the input tokens of one judge call (system prompt plus user content). */
export type InputTokenCounter = (userContent: string) => Promise<number>;

/**
 * Exact input-token counter over the count_tokens endpoint. The endpoint is
 * free, so every real judge run uses this instead of the word heuristic. The
 * count omits the json_schema output config, a constant few tokens per call.
 */
export function anthropicTokenCounter(options: AnthropicJudgeOptions): InputTokenCounter {
  const client = new Anthropic();
  const model = options.model ?? JUDGE_MODEL;
  return async (userContent: string) => {
    const response = await client.messages.countTokens({
      model,
      system: [{ type: "text", text: options.prompt }],
      messages: [{ role: "user", content: userContent }],
    });
    return response.input_tokens;
  };
}

/** Word-count heuristic for contexts without API credentials (tests, dry runs). */
function heuristicTokenCounter(promptText: string): InputTokenCounter {
  const promptTokens = Math.ceil(countWords(promptText) * TOKENS_PER_WORD);
  return async (userContent: string) =>
    promptTokens + Math.ceil(countWords(userContent) * TOKENS_PER_WORD);
}

async function mapPooled<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = Array.from<R>({ length: items.length });
  const queue = items.map((item, index) => ({ item, index }));
  const workers = Array.from({ length: Math.min(COUNT_CONCURRENCY, items.length) }, async () => {
    for (let entry = queue.shift(); entry; entry = queue.shift()) {
      results[entry.index] = await fn(entry.item);
    }
  });
  await Promise.all(workers);
  return results;
}

export interface CostEstimate {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  usd: number;
}

function modelPricing(model: string): ModelPricing {
  const id = model.toLowerCase();
  const match = FAMILY_PRICING.find(([family]) => id.includes(family));
  if (match) return match[1];
  console.error(
    `No pricing table entry for model "${model}"; cost estimate assumes Haiku-class rates and may understate the real cost.`,
  );
  return HAIKU_PRICING;
}

/**
 * Pre-run cost estimate, printed before any paid API call. Input tokens are
 * exact when a counter is supplied (every real run passes the count_tokens
 * counter); without one, the word heuristic stands in. The prompt prefix is
 * priced per call at the cache-write rate's upper bound (full price), and
 * output tokens are a fixed per-call budget, so the estimate stays
 * conservative either way.
 */
export async function estimateCost(
  texts: string[],
  options: { promptText: string; model?: string; countTokens?: InputTokenCounter },
): Promise<CostEstimate> {
  const model = options.model ?? JUDGE_MODEL;
  const pricing = modelPricing(model);
  const count = options.countTokens ?? heuristicTokenCounter(options.promptText);
  const chunks = texts.flatMap((text) => chunkDocument(text));
  const perCall = await mapPooled(chunks, count);
  const calls = chunks.length;
  const inputTokens = perCall.reduce((sum, n) => sum + n, 0);
  const outputTokens = calls * OUTPUT_TOKENS_PER_CALL;
  const usd = (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
  return { calls, inputTokens, outputTokens, usd };
}

/**
 * Cost estimate for the batched heading baseline: headings share a call per
 * `HEADING_BATCH_SIZE` group, so each counted request carries one batch in the
 * same tab-indexed shape the heading judge sends.
 */
export async function estimateHeadingCost(
  headings: string[],
  options: { promptText: string; model?: string; countTokens?: InputTokenCounter },
): Promise<CostEstimate> {
  const model = options.model ?? JUDGE_MODEL;
  const pricing = modelPricing(model);
  const count = options.countTokens ?? heuristicTokenCounter(options.promptText);
  const batches: string[] = [];
  for (let i = 0; i < headings.length; i += HEADING_BATCH_SIZE) {
    batches.push(formatHeadingBatch(headings.slice(i, i + HEADING_BATCH_SIZE)));
  }
  const perCall = await mapPooled(batches, count);
  const calls = batches.length;
  const inputTokens = perCall.reduce((sum, n) => sum + n, 0);
  const outputTokens = calls * OUTPUT_TOKENS_PER_CALL;
  const usd = (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
  return { calls, inputTokens, outputTokens, usd };
}

export interface MeaningCriterionStat {
  id: string;
  question: string;
  flagged: number;
  total: number;
  /** Sampled offending spans. Session-derived spans stay in the local report. */
  spans: string[];
}

export interface MeaningAudit {
  promptSha256: string;
  model: string;
  documents: number;
  estimatedCostUsd: number;
  criteria: MeaningCriterionStat[];
}

export interface JudgeCorpusMeta {
  promptSha256: string;
  model: string;
  estimatedCostUsd: number;
  maxSpans?: number;
}

export async function judgeCorpus(
  judge: ChunkJudge,
  texts: string[],
  meta: JudgeCorpusMeta,
): Promise<MeaningAudit> {
  const maxSpans = meta.maxSpans ?? MAX_SAMPLE_SPANS;
  const stats = new Map<CriterionKey, MeaningCriterionStat>(
    JUDGE_CRITERIA.map((c) => [
      c.key,
      { id: c.id, question: c.question, flagged: 0, total: texts.length, spans: [] },
    ]),
  );
  for (const text of texts) {
    const verdict = await judgeDocument(judge, text);
    for (const criterion of JUDGE_CRITERIA) {
      const entry = verdict[criterion.key];
      if (!entry.flagged) continue;
      const stat = stats.get(criterion.key) as MeaningCriterionStat;
      stat.flagged++;
      if (entry.span && stat.spans.length < maxSpans) stat.spans.push(entry.span);
    }
  }
  return {
    promptSha256: meta.promptSha256,
    model: meta.model,
    documents: texts.length,
    estimatedCostUsd: meta.estimatedCostUsd,
    criteria: JUDGE_CRITERIA.map((c) => stats.get(c.key) as MeaningCriterionStat),
  };
}

export type MeaningDetector = (rows: DeliverableRow[]) => Promise<MeaningAudit>;

export interface MeaningDetectorOptions {
  model?: string;
  /** Cap on documents judged per run (cost guardrail). */
  limit?: number;
  /** Documents shorter than this are skipped: too little prose to judge. */
  minWords?: number;
  promptPath?: string;
}

export const DEFAULT_JUDGE_LIMIT = 100;
export const DEFAULT_MIN_WORDS = 30;

/**
 * Batch detector for the analyze pipeline. Prints the cost estimate before
 * any API call.
 */
export function meaningDetector(options: MeaningDetectorOptions = {}): MeaningDetector {
  return async (rows: DeliverableRow[]) => {
    const model = options.model ?? JUDGE_MODEL;
    const limit = options.limit ?? DEFAULT_JUDGE_LIMIT;
    const minWords = options.minWords ?? DEFAULT_MIN_WORDS;
    const prompt = await loadPrompt(options.promptPath);
    const texts = rows
      .map((r) => r.text)
      .filter((t) => countWords(t) >= minWords)
      .slice(0, limit);
    const cost = await estimateCost(texts, {
      promptText: prompt.text,
      model,
      countTokens: anthropicTokenCounter({ prompt: prompt.text, model }),
    });
    console.error(
      `Meaning judge: ${texts.length} documents (limit ${limit}), ${cost.calls} calls, est. $${cost.usd.toFixed(4)} on ${model} (prompt ${prompt.sha256.slice(0, 12)})`,
    );
    const judge = anthropicChunkJudge({ prompt: prompt.text, model });
    return judgeCorpus(judge, texts, {
      promptSha256: prompt.sha256,
      model,
      estimatedCostUsd: cost.usd,
    });
  };
}

/**
 * Schema for the heading baseline: one boolean per heading, by index, marking
 * whether the heading is sentence-shaped.
 */
export function headingBatchSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      headings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: { type: "integer" },
            sentence_shaped: { type: "boolean" },
          },
          required: ["index", "sentence_shaped"],
          additionalProperties: false,
        },
      },
    },
    required: ["headings"],
    additionalProperties: false,
  };
}

export function parseHeadingVerdicts(json: string, expected: number): boolean[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(`Heading judge returned invalid JSON: ${(error as Error).message}`, {
      cause: error,
    });
  }
  const record = parsed as Record<string, unknown>;
  const entries = record.headings;
  if (!Array.isArray(entries)) throw new Error('Heading verdict missing "headings" array');
  const verdicts = Array.from<boolean>({ length: expected }).fill(false);
  const seen = new Set<number>();
  for (const entry of entries) {
    const item = entry as Record<string, unknown>;
    const index = item.index;
    const flagged = item.sentence_shaped;
    if (typeof index !== "number" || typeof flagged !== "boolean") {
      throw new Error("Heading verdict entries must carry numeric index and boolean verdict");
    }
    if (index < 0 || index >= expected) {
      throw new Error(`Heading verdict index ${index} out of range (expected 0..${expected - 1})`);
    }
    verdicts[index] = flagged;
    seen.add(index);
  }
  if (seen.size !== expected) {
    throw new Error(`Heading verdict covered ${seen.size} of ${expected} headings`);
  }
  return verdicts;
}

export const HEADING_BATCH_SIZE = 25;

export type HeadingJudge = (headings: string[]) => Promise<boolean[]>;

/** Tab-indexed batch shape shared by the heading judge and its cost estimate. */
export function formatHeadingBatch(headings: string[]): string {
  return headings.map((heading, index) => `${index}\t${heading}`).join("\n");
}

export function anthropicHeadingJudge(options: AnthropicJudgeOptions): HeadingJudge {
  const client = new Anthropic();
  const model = options.model ?? JUDGE_MODEL;
  return async (headings: string[]) => {
    const input = formatHeadingBatch(headings);
    const response = await client.messages.create({
      model,
      max_tokens: 2048,
      temperature: 0,
      system: [{ type: "text", text: options.prompt, cache_control: { type: "ephemeral" } }],
      output_config: {
        format: { type: "json_schema", schema: headingBatchSchema() },
      },
      messages: [{ role: "user", content: input }],
    });
    const block = response.content.find((b) => b.type === "text");
    if (!block) {
      throw new Error(`Judge response contained no text block (stop: ${response.stop_reason})`);
    }
    return parseHeadingVerdicts(block.text, headings.length);
  };
}

export async function judgeHeadings(judge: HeadingJudge, headings: string[]): Promise<boolean[]> {
  const verdicts: boolean[] = [];
  for (let i = 0; i < headings.length; i += HEADING_BATCH_SIZE) {
    verdicts.push(...(await judge(headings.slice(i, i + HEADING_BATCH_SIZE))));
  }
  return verdicts;
}
