import type {
  PostToolUseFailureHookInput,
  PostToolUseHookInput,
  PreToolUseHookInput,
} from "@anthropic-ai/claude-agent-sdk";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object";
}

function hasBase(value: unknown): value is Record<string, unknown> & { hook_event_name: unknown } {
  if (!isRecord(value)) return false;
  return typeof value.session_id === "string" && typeof value.cwd === "string";
}

export function isPreToolUse(value: unknown): value is PreToolUseHookInput {
  return hasBase(value) && value.hook_event_name === "PreToolUse";
}

export function isPostToolUse(
  value: unknown,
): value is PostToolUseHookInput | PostToolUseFailureHookInput {
  return (
    hasBase(value) &&
    (value.hook_event_name === "PostToolUse" || value.hook_event_name === "PostToolUseFailure")
  );
}

export function bashCommand(toolInput: unknown): string | null {
  if (!isRecord(toolInput) || typeof toolInput.command !== "string") return null;
  return toolInput.command === "" ? null : toolInput.command;
}

// A hook that dies on an unreadable payload takes the tool call down with it, so
// every failure reaching stdin is reported on stderr and the hook exits without output.
export async function readHookInput<T>(
  guard: (value: unknown) => value is T,
  hook: string,
): Promise<T | null> {
  try {
    const value: unknown = JSON.parse(await Bun.stdin.text());
    if (guard(value)) return value;
    console.error(`[gitlab/${hook}] Failed to parse hook input: unexpected payload shape`);
  } catch (error) {
    console.error(
      `[gitlab/${hook}] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return null;
}
