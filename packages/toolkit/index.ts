import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";

export type {
  PostToolUseHookInput,
  PostToolUseHookSpecificOutput,
  PreToolUseHookInput,
  PreToolUseHookSpecificOutput,
  SyncHookJSONOutput,
} from "@anthropic-ai/claude-agent-sdk";
export { readStdinJson, writeStdoutJson };

export type WriteInput = { file_path: string; content: string };
export type EditInput = { file_path: string; old_string: string; new_string: string };
export type FileInput = { file_path?: string };
export type WebFetchInput = { url: string; prompt?: string };

function basename(filePath: string): string {
  return filePath.replace(/\/+$/, "").split("/").pop() ?? "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Derive a `plugin/module` hook name from the runtime environment so call
 * sites don't repeat it. The module comes from the entry script's basename
 * (`process.argv[1]`). The plugin comes from `CLAUDE_PLUGIN_ROOT` (set when a
 * plugin hook runs), falling back to the `plugins/<name>/` segment of the
 * entry path for in-repo runs, then to the bare module name.
 */
export function deriveHookName(): string {
  const entry = process.argv[1] ?? "";
  const moduleName = basename(entry).replace(/\.[^.]+$/, "") || "hook";

  const root = process.env.CLAUDE_PLUGIN_ROOT;
  if (root) return `${basename(root)}/${moduleName}`;

  const parts = entry.split("/");
  const pluginsIndex = parts.lastIndexOf("plugins");
  const plugin = pluginsIndex >= 0 ? parts[pluginsIndex + 1] : undefined;
  return plugin ? `${plugin}/${moduleName}` : moduleName;
}

/**
 * Read and parse a hook payload from stdin, run the handler, and write any
 * non-null return value to stdout as JSON. Meant to be called under an
 * `if (import.meta.main)` guard.
 *
 * The hook name (used in the error logs) defaults to a `plugin/module` value
 * derived from the runtime via {@link deriveHookName}. Pass `name` to override
 * it. Both a parse failure and a handler that throws log `[name] ...` to stderr
 * and return without exiting non-zero, so a failing hook stays non-blocking,
 * matching the dominant existing hook pattern.
 */
export async function runHook<I, O>(
  handler: (input: I) => O | null | Promise<O | null>,
  name?: string,
): Promise<void> {
  let input: I;
  try {
    input = await readStdinJson<I>();
  } catch (error) {
    console.error(
      `[${name ?? deriveHookName()}] Failed to parse hook input: ${errorMessage(error)}`,
    );
    return;
  }

  try {
    const output = await handler(input);
    if (output != null) {
      writeStdoutJson(output);
    }
  } catch (error) {
    console.error(`[${name ?? deriveHookName()}] ${errorMessage(error)}`);
  }
}

export const preToolUse = {
  deny(reason: string): SyncHookJSONOutput {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    };
  },
  ask(reason: string): SyncHookJSONOutput {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: reason,
      },
    };
  },
  context(additionalContext: string): SyncHookJSONOutput {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext,
      },
    };
  },
  updatedInput(
    updatedInput: Record<string, unknown>,
    additionalContext?: string,
  ): SyncHookJSONOutput {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        updatedInput,
        ...(additionalContext === undefined ? {} : { additionalContext }),
      },
    };
  },
};

export const postToolUse = {
  context(additionalContext: string): SyncHookJSONOutput {
    return {
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext,
      },
    };
  },
};
