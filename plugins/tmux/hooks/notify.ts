#!/usr/bin/env bun
import { writeFileSync } from "node:fs";
import type { NotificationHookInput } from "@anthropic-ai/claude-agent-sdk";

export function shouldNotify(env: Record<string, string | undefined>): boolean {
  return Boolean(env.TMUX);
}

if (import.meta.main) {
  (async () => {
    const { readStdinJson } = await import("@constellos/claude-code-kit/runners");
    try {
      await readStdinJson<NotificationHookInput>();
    } catch (error) {
      console.error(
        `[tmux/notify] Failed to parse: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }

    if (!shouldNotify(process.env)) return;

    writeFileSync("/dev/tty", "\x07");
  })().catch(console.error);
}
