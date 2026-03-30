import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
export type { SyncHookJSONOutput };

export type WriteInput = { file_path: string; content: string };
export type EditInput = { file_path: string; new_string: string };

export function getExtension(filePath: string): string {
  const parts = filePath.split(".");
  return parts.length > 1 ? (parts.at(-1) ?? "") : "";
}

export function isMarkdownFile(ext: string): boolean {
  return ext === "md" || ext === "markdown";
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
