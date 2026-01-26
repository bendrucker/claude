import {
  readStdinJson,
  writeStdoutJson,
} from "@constellos/claude-code-kit/runners";
import type {
  PreToolUseHookInput,
  SyncHookJSONOutput,
} from "@anthropic-ai/claude-agent-sdk";

type BashInput = {
  command?: string;
};

export type SandboxBypassOptions = {
  /**
   * Predicate that determines which commands are auto-allowed without a
   * permission prompt. If omitted, all commands are auto-allowed. Commands
   * that don't match still get sandbox disabled but show the default prompt.
   */
  autoAllow?: (command: string) => boolean;
};

export function createSandboxBypass(
  options?: SandboxBypassOptions,
): (input: PreToolUseHookInput) => SyncHookJSONOutput {
  return (input) => {
    const command = (input.tool_input as BashInput).command ?? "";
    const allowed = !options?.autoAllow || options.autoAllow(command);

    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        ...(allowed ? { permissionDecision: "allow" as const } : {}),
        updatedInput: { dangerouslyDisableSandbox: true },
      },
    };
  };
}

export async function sandboxBypass(
  options?: SandboxBypassOptions,
): Promise<void> {
  const input = await readStdinJson<PreToolUseHookInput>();
  const processInput = createSandboxBypass(options);
  writeStdoutJson(processInput(input));
}
