import Anthropic from "@anthropic-ai/sdk";
import Builder from "fast-xml-builder";
import { z } from "zod";
import type { Provenance } from "../detection/provenance";
import type { CommentKind, Language } from "../detection/types";
import { type JudgeAdapter, shardJudge } from "../judge/adapter";
import { BATCH_SIZE, parseVerdict } from "../judge/judge";
import { batchVerdictSchema, type Verdict } from "../judge/schema";

/**
 * The calibration oracle: the Anthropic SDK judge used only under `evals/`, the
 * deterministic ground truth the fixture corpus is scored against. It renders an
 * indexed batch, scores it at temperature 0, and validates the response.
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
  /** Who last touched the comment's lines, when known. */
  provenance?: Provenance | undefined;
}

/** Judges a batch of comments. The eval tests mock this. The SDK call implements it. */
export type CommentJudge = (inputs: CommentJudgeInput[]) => Promise<Verdict[]>;

const xml = new Builder({
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
        provenance: input.provenance,
      })),
    },
  });
}

const BatchEntry = z.looseObject(
  { index: z.int({ error: "entry index must be an integer" }), verdict: z.unknown().optional() },
  { error: "entries must be objects" },
);

const Batch = z.looseObject(
  { verdicts: z.array(BatchEntry, { error: `missing "verdicts" array` }) },
  { error: "must be a JSON object" },
);

/**
 * Parses the `{ verdicts: [{ index, verdict }] }` batch shape, validating that
 * every index in 0..expected-1 is present exactly once, and returns verdicts
 * ordered by index.
 */
export function parseBatchVerdicts(json: string, expected: number): Verdict[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    throw new Error(
      `Judge returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  const parsed = Batch.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Judge batch ${parsed.error.issues[0]?.message}`);
  }

  const verdicts: (Verdict | undefined)[] = Array.from({ length: expected });
  const seen = new Set<number>();
  for (const entry of parsed.data.verdicts) {
    if (entry.index < 0 || entry.index >= expected) {
      throw new Error(
        `Judge batch index ${entry.index} out of range (expected 0..${expected - 1})`,
      );
    }
    if (seen.has(entry.index)) {
      throw new Error(`Judge batch index ${entry.index} appears more than once`);
    }
    verdicts[entry.index] = parseVerdict(entry.verdict, `index ${entry.index}`);
    seen.add(entry.index);
  }
  if (seen.size !== expected) {
    throw new Error(`Judge batch covered ${seen.size} of ${expected} comments`);
  }
  return verdicts.filter((verdict) => verdict !== undefined);
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
      // oxlint-disable-next-line typescript/no-deprecated -- the pinned model still honors temperature, and dropping it costs the judge its determinism.
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

/**
 * The oracle behind the audit's judge seam: scores each written shard in one
 * Messages call and writes its verdict file where the agent fan-out would.
 */
export function anthropicJudgeAdapter(options: AnthropicJudgeOptions): JudgeAdapter {
  return shardJudge(anthropicCommentJudge(options));
}
