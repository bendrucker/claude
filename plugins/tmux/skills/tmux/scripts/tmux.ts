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
  const pane = process.env.TMUX_PANE ?? tmuxSync("display-message", "-p", "#{pane_id}");
  if (!pane) {
    throw new Error("Could not determine pane ID from TMUX_PANE or tmux query");
  }
  return pane;
}
