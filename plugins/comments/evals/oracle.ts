import Anthropic from "@anthropic-ai/sdk";
import { XMLBuilder } from "fast-xml-parser";
import type { CommentKind, Language } from "../detection/types";
import { BATCH_SIZE, parseVerdict } from "../judge/judge";
import { batchVerdictSchema, type Verdict } from "../judge/schema";

/**
 * The calibration oracle: the Anthropic SDK judge that survives only under
 * `evals/`. The product path fans out Claude Code agents instead. This remains
 * the deterministic ground truth the fixture corpus is scored against. It renders
 * an indexed batch, scores it at temperature 0, and validates the response.
 */

export const JUDGE_MODEL = "claude-sonnet-4-6";

/** One comment the oracle scores, with the context the rubric needs. */
export interface CommentJudgeInput {
  path: string;
  language: Language;
  kind: CommentKind;
  /** The comment text, exactly as it appears in source. */
  text: string;
  /** Surrounding source lines, numbered, for the what-on-dense call. */
  context: string;
}

/** Judges a batch of comments. The eval tests mock this. The SDK call implements it. */
export type CommentJudge = (inputs: CommentJudgeInput[]) => Promise<Verdict[]>;

const xml = new XMLBuilder({
  format: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  suppressEmptyNode: true,
});

/**
 * Render a batch as XML the model scores, one `<comment>` per input carrying its
 * 0-based `index` so a dropped or reordered verdict is detectable. The builder
 * escapes the comment text and surrounding code, and is deterministic across
 * calls so identical inputs cache and hash identically.
 */
export function formatBatch(inputs: CommentJudgeInput[]): string {
  return xml.build({
    comments: {
      comment: inputs.map((input, index) => ({
        "@_index": index,
        path: input.path,
        language: input.language,
        kind: input.kind,
        text: input.text,
        context: input.context,
      })),
    },
  });
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
    verdicts[index] = parseVerdict(record.verdict, `index ${index}`);
    seen.add(index);
  }
  if (seen.size !== expected) {
    throw new Error(`Judge batch covered ${seen.size} of ${expected} comments`);
  }
  return verdicts as Verdict[];
}

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
