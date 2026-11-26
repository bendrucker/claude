import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
export type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

// Every field the writing hooks read off `tool_input`.
const ToolInput = z.looseObject({
  file_path: z.string().optional().catch(undefined),
  command: z.string().optional().catch(undefined),
});
export type ToolInput = z.infer<typeof ToolInput>;

export function toolInputOf(input: { tool_input: unknown }): ToolInput {
  return ToolInput.safeParse(input.tool_input).data ?? {};
}

export type Decision = "deny" | "context";
export type HookEvent = "PreToolUse" | "PostToolUse";

export function isPlanMode(input: { permission_mode?: string | undefined }): boolean {
  return input.permission_mode === "plan";
}

export function formatDecision(reason: string): SyncHookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

export function formatContext(event: HookEvent, context: string): SyncHookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: event,
      additionalContext: context,
    },
  };
}
