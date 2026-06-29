import Anthropic from "@anthropic-ai/sdk";
import {
  type CommentJudge,
  type CommentJudgeInput,
  formatBatch,
  parseBatchVerdicts,
} from "../judge/judge";
import { batchVerdictSchema } from "../judge/schema";

/**
 * The calibration oracle: the Anthropic SDK judge that survives only under
 * `evals/`. The product path fans out Claude Code agents instead; this remains
 * the deterministic ground truth the fixture corpus is scored against. Subtle
 * what-on-dense calls default to Sonnet at temperature 0.
 */

export const JUDGE_MODEL = "claude-sonnet-4-6";

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
