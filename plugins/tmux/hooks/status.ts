#!/usr/bin/env bun
import type { StopHookInput } from "@anthropic-ai/claude-agent-sdk";

export function mapStopReason(stopHookActive: boolean): string {
  return stopHookActive ? "done" : "idle";
}

if (import.meta.main) {
  (async () => {
    const { readStdinJson } = await import("@constellos/claude-code-kit/runners");
    let input: StopHookInput;
    try {
      input = await readStdinJson<StopHookInput>();
    } catch (error) {
      console.error(
        `[tmux/status] Failed to parse: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }

    if (!process.env.TMUX) return;

    const status = mapStopReason(input.stop_hook_active);
    const proc = Bun.spawn(["tmux", "set", "-p", "@claude_status", status], {
      stdout: "ignore",
      stderr: "ignore",
    });
    await proc.exited;
  })().catch(console.error);
}
