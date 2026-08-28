import type {
  PostToolUseFailureHookInput,
  PreToolUseHookInput,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const base = {
  session_id: z.string().catch(""),
  transcript_path: z.string().catch(""),
  cwd: z.string().catch(""),
  tool_name: z.string().catch(""),
  tool_input: z.unknown().catch(undefined),
  tool_use_id: z.string().catch(""),
};

export const PreToolUse = z.looseObject({
  ...base,
  hook_event_name: z.literal("PreToolUse"),
}) satisfies z.ZodType<PreToolUseHookInput>;

export const PostToolUseFailure = z.looseObject({
  ...base,
  hook_event_name: z.literal("PostToolUseFailure"),
  error: z.string().catch(""),
}) satisfies z.ZodType<PostToolUseFailureHookInput>;

/** Every Bash `tool_input` field the git hooks read. */
export const BashInput = z.looseObject({ command: z.string().optional().catch(undefined) });
export type BashInput = z.infer<typeof BashInput>;
