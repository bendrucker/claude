#!/usr/bin/env bun

export function tmuxSync(...args: string[]): string | null {
  const proc = Bun.spawnSync(["tmux", ...args], {
    stdout: "pipe",
    stderr: "inherit",
  });
  if (proc.exitCode !== 0) return null;
  return proc.stdout.toString().trim();
}

export function tmuxRun(...args: string[]): void {
  Bun.spawnSync(["tmux", ...args], { stderr: "inherit" });
}

export function currentPane(): string {
  const pane = process.env.TMUX_PANE;
  if (!pane) {
    throw new Error("TMUX_PANE is not set — not running inside tmux");
  }
  return pane;
}
