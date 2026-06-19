import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";

/**
 * LLM judge for PR section headings. Mirrors the calling/batching/JSON-parsing
 * pattern in plugins/writing/skills/analyze/scripts/judge.ts: prompt from a
 * constant path, single cached system prefix, structured JSON output, headings
 * batched per call and aligned back by index.
 *
 * The judge sees each heading with its parent heading and a section-body
 * excerpt (see judge-prompt.md "Input and Output"). It returns one verdict per
 * heading: {index, bad, reason, rewrite}.
 */

export const JUDGE_MODEL = "claude-sonnet-4-6";
export const HEADING_BATCH_SIZE = 25;
export const PROMPT_PATH = join(import.meta.dirname, "judge-prompt.md");

export interface JudgeInput {
  index: number;
  heading: string;
  parent: string;
  excerpt: string;
}

export interface JudgeVerdict {
  index: number;
  bad: boolean;
  reason: string;
  rewrite: string;
}

export interface JudgeOptions {
  model?: string;
  prompt?: string;
  batchSize?: number;
}

export async function loadPrompt(promptPath: string = PROMPT_PATH): Promise<string> {
  return Bun.file(promptPath).text();
}

function requireApiKey(): void {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    throw new Error(
      "Neither ANTHROPIC_API_KEY nor ANTHROPIC_AUTH_TOKEN is set. The judge runs only with live API credentials.",
    );
  }
}

/**
 * Renders one heading block for the user message. The judge reads the index,
 * the heading text, its parent heading (or "(top level)"), and the first lines
 * of the section body, exactly as judge-prompt.md's "Input and Output"
 * section describes.
 */
export function renderInput(item: JudgeInput): string {
  const excerpt = item.excerpt.trim();
  const body = excerpt.length > 0 ? excerpt : "(no section body)";
  return [
    `### Heading ${item.index}`,
    `Heading: ${item.heading}`,
    `Parent: ${item.parent}`,
    "Section body:",
    body,
  ].join("\n");
}

export function renderBatch(items: JudgeInput[]): string {
  return items.map(renderInput).join("\n\n");
}

/** JSON schema for the judge's structured output (one verdict per heading). */
export function verdictSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      verdicts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: { type: "integer" },
            bad: { type: "boolean" },
            reason: { type: "string" },
            rewrite: { type: "string" },
          },
          required: ["index", "bad", "reason", "rewrite"],
          additionalProperties: false,
        },
      },
    },
    required: ["verdicts"],
    additionalProperties: false,
  };
}

/**
 * Parses the judge's JSON object into verdicts aligned to the requested
 * indices. Throws when the response is malformed or omits a heading.
 */
export function parseVerdicts(jsonText: string, expectedIndices: number[]): JudgeVerdict[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    throw new Error(`Judge returned invalid JSON: ${(error as Error).message}`);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Judge verdict must be a JSON object");
  }
  const record = parsed as Record<string, unknown>;
  const entries = record.verdicts;
  if (!Array.isArray(entries)) {
    throw new Error('Judge verdict missing "verdicts" array');
  }
  const byIndex = new Map<number, JudgeVerdict>();
  for (const entry of entries) {
    const item = entry as Record<string, unknown>;
    if (typeof item.index !== "number" || typeof item.bad !== "boolean") {
      throw new Error("Each verdict needs a numeric index and a boolean bad");
    }
    const reason = typeof item.reason === "string" ? item.reason : "";
    const rewrite = typeof item.rewrite === "string" ? item.rewrite : "";
    byIndex.set(item.index, { index: item.index, bad: item.bad, reason, rewrite });
  }
  return expectedIndices.map((index) => {
    const verdict = byIndex.get(index);
    if (!verdict) {
      throw new Error(`Judge verdict missing heading index ${index}`);
    }
    return verdict;
  });
}

/**
 * Judges a batch of headings in one API call. Temperature 0, structured JSON
 * output, prompt cached as a stable system prefix.
 */
export async function judgeBatch(
  client: Anthropic,
  items: JudgeInput[],
  prompt: string,
  model: string,
): Promise<JudgeVerdict[]> {
  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    temperature: 0,
    system: [{ type: "text", text: prompt, cache_control: { type: "ephemeral" } }],
    output_config: { format: { type: "json_schema", schema: verdictSchema() } },
    messages: [{ role: "user", content: renderBatch(items) }],
  });
  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    throw new Error(`Judge response contained no text block (stop: ${response.stop_reason})`);
  }
  return parseVerdicts(
    block.text,
    items.map((i) => i.index),
  );
}

/**
 * Judges all headings, batching by HEADING_BATCH_SIZE. Returns verdicts aligned
 * to the input order. Requires ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN.
 */
export async function judgeHeadings(
  items: JudgeInput[],
  opts: JudgeOptions = {},
): Promise<JudgeVerdict[]> {
  requireApiKey();
  const model = opts.model ?? JUDGE_MODEL;
  const batchSize = opts.batchSize ?? HEADING_BATCH_SIZE;
  const prompt = opts.prompt ?? (await loadPrompt());
  const client = new Anthropic();
  const verdicts: JudgeVerdict[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    verdicts.push(...(await judgeBatch(client, batch, prompt, model)));
  }
  return verdicts;
}
