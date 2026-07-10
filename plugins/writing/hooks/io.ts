import type { PreToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";

export type { SyncHookJSONOutput };

export type WriteInput = { file_path: string; content: string };
export type EditInput = { file_path: string; new_string: string };

// A checker's finding: the formatted hook output plus the rule category the
// dispatcher uses for session-scoped repeat suppression and the run log.
// suppressible: false exempts a context-shaped output from repeat suppression
// (deny-tier findings reformatted as per-file fix-it reminders).
export type HookResult = { output: SyncHookJSONOutput; category: string; suppressible?: boolean };

export type PermissionTier = "deny" | "ask" | "context";

export function tierOf(output: SyncHookJSONOutput): PermissionTier {
  const specific = output.hookSpecificOutput as Record<string, unknown> | undefined;
  const decision = specific?.permissionDecision;
  return decision === "deny" || decision === "ask" ? decision : "context";
}

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
