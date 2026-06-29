import { createHash } from "node:crypto";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { CommentKind, Language } from "../detection/types";
import { batchVerdictSchema, type SlopCategory, type Verdict } from "./schema";

/**
 * Meaning-layer LLM judge for introduced code comments. Batch-only: scores N
 * comments per call by 0-based index.
 *
 * The what-on-dense vs what-on-simple distinction is subtle, so the judge
 * defaults to Sonnet. The prompt is a committed, versioned artifact. Every run
 * records its sha256, so a prompt edit invalidates prior numbers.
 */

export const JUDGE_MODEL = "claude-sonnet-4-6";

export const PROMPT_PATH = join(import.meta.dirname, "prompt.md");

/** One comment the judge scores, with the context the rubric needs. */
export interface CommentJudgeInput {
  path: string;
  language: Language;
  kind: CommentKind;
  /** The comment text, exactly as it appears in source. */
  text: string;
  /** Surrounding source lines, numbered, for the what-on-dense call. */
  context: string;
}

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

/**
 * Renders a batch as indexed entries the model scores. Stable across calls so
 * the same inputs cache and hash identically. Each entry is delimited by a
 * banner carrying its index, so a dropped or reordered entry is detectable.
 */
export function formatBatch(inputs: CommentJudgeInput[]): string {
  return inputs
    .map((input, index) => {
      return [
        `===== COMMENT ${index} =====`,
        `path: ${input.path}`,
        `language: ${input.language}`,
        `kind: ${input.kind}`,
        `--- comment text ---`,
        input.text,
        `--- surrounding code ---`,
        input.context,
      ].join("\n");
    })
    .join("\n\n");
}

/**
 * Parses the `{ verdicts: [{ index, verdict }] }` batch shape, validating that
 * every index in 0..expected-1 is present exactly once, and returns verdicts
 * ordered by index.
 */
export function parseBatchVerdicts(json: string, expected: number): Verdict[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(`Judge returned invalid JSON: ${(error as Error).message}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Judge batch must be a JSON object");
  }
  const entries = (parsed as Record<string, unknown>).verdicts;
  if (!Array.isArray(entries)) throw new Error('Judge batch missing "verdicts" array');
  const verdicts = new Array<Verdict | undefined>(expected);
  const seen = new Set<number>();
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) {
      throw new Error("Judge batch entries must be objects");
    }
    const record = entry as Record<string, unknown>;
    const index = record.index;
    if (typeof index !== "number" || !Number.isInteger(index)) {
      throw new Error("Judge batch entry index must be an integer");
    }
    if (index < 0 || index >= expected) {
      throw new Error(`Judge batch index ${index} out of range (expected 0..${expected - 1})`);
    }
    if (seen.has(index)) {
      throw new Error(`Judge batch index ${index} appears more than once`);
    }
    verdicts[index] = parseVerdict(record.verdict, index);
    seen.add(index);
  }
  if (seen.size !== expected) {
    throw new Error(`Judge batch covered ${seen.size} of ${expected} comments`);
  }
  return verdicts as Verdict[];
}

function parseVerdict(value: unknown, index: number): Verdict {
  if (typeof value !== "object" || value === null) {
    throw new Error(`Judge verdict ${index} must be an object`);
  }
  const record = value as Record<string, unknown>;
  if (typeof record.isSlop !== "boolean") {
    throw new Error(`Judge verdict ${index} "isSlop" must be a boolean`);
  }
  if (record.category !== null && typeof record.category !== "string") {
    throw new Error(`Judge verdict ${index} "category" must be a string or null`);
  }
  if (typeof record.confidence !== "string") {
    throw new Error(`Judge verdict ${index} "confidence" must be a string`);
  }
  if (typeof record.rationale !== "string") {
    throw new Error(`Judge verdict ${index} "rationale" must be a string`);
  }
  const verdict: Verdict = {
    isSlop: record.isSlop,
    category: record.category as SlopCategory | null,
    confidence: record.confidence as Verdict["confidence"],
    rationale: record.rationale,
  };
  if (typeof record.suggestedFix === "string") verdict.suggestedFix = record.suggestedFix;
  if (Array.isArray(record.trimToLines)) {
    verdict.trimToLines = record.trimToLines.filter(
      (line): line is number => typeof line === "number",
    );
  }
  return verdict;
}

/** Judges a batch of comments. The seam tests mock; the SDK call implements. */
export type CommentJudge = (inputs: CommentJudgeInput[]) => Promise<Verdict[]>;

export interface AnthropicJudgeOptions {
  prompt: string;
  model?: string;
}

/**
 * Real judge over the Messages API: temperature 0, structured JSON output,
 * prompt cached as a stable system prefix so repeated calls share it.
 */
export function anthropicCommentJudge(options: AnthropicJudgeOptions): CommentJudge {
  const client = new Anthropic();
  const model = options.model ?? JUDGE_MODEL;
  return async (inputs: CommentJudgeInput[]) => {
    if (inputs.length === 0) return [];
    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      temperature: 0,
      system: [{ type: "text", text: options.prompt, cache_control: { type: "ephemeral" } }],
      output_config: { format: { type: "json_schema", schema: batchVerdictSchema() } },
      messages: [{ role: "user", content: formatBatch(inputs) }],
    });
    const block = response.content.find((b) => b.type === "text");
    if (!block) {
      throw new Error(`Judge response contained no text block (stop: ${response.stop_reason})`);
    }
    return parseBatchVerdicts(block.text, inputs.length);
  };
}

export const BATCH_SIZE = 20;

export async function judgeComments(
  judge: CommentJudge,
  inputs: CommentJudgeInput[],
): Promise<Verdict[]> {
  const batches: CommentJudgeInput[][] = [];
  for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
    batches.push(inputs.slice(i, i + BATCH_SIZE));
  }
  const results = await Promise.all(batches.map((batch) => judge(batch)));
  return results.flat();
}
