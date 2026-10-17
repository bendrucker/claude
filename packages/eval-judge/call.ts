import { type Options, query } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { decode, decodeJson } from "../decode/index";

/** The slice of an Agent SDK message a structured call reads. */
export interface Message {
  type: string;
  subtype?: string;
  structured_output?: unknown;
  result?: string;
}

export type QueryFn = (args: { prompt: string; options: Options }) => AsyncIterable<Message>;

export interface StructuredOptions {
  model: string;
  /** Names the reply in decode errors, such as "judge reply". */
  label: string;
  /** Replaces the Agent SDK `query`, for tests. */
  query?: QueryFn;
}

/** The environment minus API credentials, so the call spends the Claude Code login's subscription. */
export function subscriptionEnv(
  env: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  const out = { ...env };
  delete out.ANTHROPIC_API_KEY;
  delete out.ANTHROPIC_AUTH_TOKEN;
  return out;
}

/** The JSON schema a structured-output call sends for `schema`. */
export function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _, ...rest } = z.toJSONSchema(schema);
  return rest;
}

/**
 * One tool-less, settings-free model call whose reply must match `schema`, through the Agent SDK
 * on subscription auth.
 */
export async function structured<S extends z.ZodType>(
  schema: S,
  prompt: string,
  options: StructuredOptions,
): Promise<z.output<S>> {
  const run = options.query ?? query;
  for await (const message of run({
    prompt,
    options: {
      model: options.model,
      // Structured output lands through a tool call, plus a retry turn when the schema rejects it.
      maxTurns: 5,
      tools: [],
      settingSources: [],
      mcpServers: {},
      strictMcpConfig: true,
      env: subscriptionEnv(),
      outputFormat: { type: "json_schema", schema: jsonSchema(schema) },
    },
  })) {
    if (message.type !== "result") continue;
    if (message.subtype !== "success") {
      throw new Error(`${options.label} call failed: ${message.subtype ?? "unknown"}`);
    }
    return message.structured_output !== undefined
      ? decode(schema, message.structured_output, options.label)
      : decodeJson(schema, message.result ?? "", options.label);
  }
  throw new Error(`${options.label} call produced no result message`);
}
