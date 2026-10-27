import type { PreToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
export type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

// Every field any writing hook reads off `tool_input`, across the Write, Edit,
// MultiEdit, and Bash surfaces.
const ToolInput = z.looseObject({
  file_path: z.string().optional().catch(undefined),
  content: z.string().optional().catch(undefined),
  new_string: z.string().optional().catch(undefined),
  old_string: z.string().optional().catch(undefined),
  replace_all: z.boolean().optional().catch(undefined),
  command: z.string().optional().catch(undefined),
  edits: z
    .array(
      z.looseObject({
        new_string: z.string().optional().catch(undefined),
        old_string: z.string().optional().catch(undefined),
        replace_all: z.boolean().optional().catch(undefined),
      }),
    )
    .optional()
    .catch(undefined),
});
export type ToolInput = z.infer<typeof ToolInput>;

export function toolInputOf(input: PreToolUseHookInput): ToolInput {
  return ToolInput.safeParse(input.tool_input).data ?? {};
}

/** The text a Write or Edit puts on disk, and where. Null for any other tool. */
export function editedContent(
  input: PreToolUseHookInput,
): { content: string; filePath: string } | null {
  if (input.tool_name !== "Write" && input.tool_name !== "Edit") return null;
  const toolInput = toolInputOf(input);
  const content = input.tool_name === "Write" ? toolInput.content : toolInput.new_string;
  if (content === undefined || toolInput.file_path === undefined) return null;
  return { content, filePath: toolInput.file_path };
}

export type PermissionTier = "deny" | "ask" | "context";

export function isPlanMode(input: PreToolUseHookInput): boolean {
  return input.permission_mode === "plan";
}

export function formatDecision(decision: "deny" | "ask", reason: string): SyncHookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
  };
}

export function formatContext(context: string): SyncHookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: context,
    },
  };
}
