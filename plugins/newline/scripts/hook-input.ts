import type { PostToolUseHookInput, PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
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

export const PostToolUse = z.looseObject({
  ...base,
  hook_event_name: z.literal("PostToolUse"),
  tool_response: z.unknown().catch(undefined),
}) satisfies z.ZodType<PostToolUseHookInput>;

export const FileInput = z.looseObject({ file_path: z.string().optional().catch(undefined) });

export function filePathOf(toolInput: unknown): string | undefined {
  return FileInput.safeParse(toolInput).data?.file_path;
}
