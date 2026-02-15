#!/usr/bin/env bun
import { appendFileSync } from "node:fs";
import type { SessionStartHookInput } from "@anthropic-ai/claude-agent-sdk";

export function formatEnvContent(session: string, window: string, pane: string): string {
  return `${[
    `CLAUDE_TMUX_SESSION=${session}`,
    `CLAUDE_TMUX_WINDOW=${window}`,
    `CLAUDE_TMUX_PANE=${pane}`,
  ].join("\n")}\n`;
}

async function captureTmuxInfo(): Promise<{
  session: string;
  window: string;
  pane: string;
} | null> {
  const proc = Bun.spawn(
    ["tmux", "display-message", "-p", "#{session_name}\n#{window_index}\n#{pane_index}"],
    { stdout: "pipe", stderr: "ignore" },
  );
  const output = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) return null;

  const [session, window, pane] = output.trim().split("\n");
  if (!session || !window || !pane) return null;
  return { session, window, pane };
}

if (import.meta.main) {
  (async () => {
    const { readStdinJson } = await import("@constellos/claude-code-kit/runners");
    try {
      await readStdinJson<SessionStartHookInput>();
    } catch (error) {
      console.error(
        `[tmux/context] Failed to parse: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }

    if (!process.env.TMUX) return;

    const info = await captureTmuxInfo();
    if (!info) return;

    const envFile = process.env.CLAUDE_ENV_FILE;
    if (!envFile) return;

    appendFileSync(envFile, formatEnvContent(info.session, info.window, info.pane));
  })().catch(console.error);
}
