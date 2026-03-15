export function tmux(...args: string[]): void {
  Bun.spawnSync(["tmux", ...args], { stderr: "inherit" });
}

export function tmuxQuery(...args: string[]): string | null {
  const proc = Bun.spawnSync(["tmux", ...args], {
    stdout: "pipe",
    stderr: "inherit",
  });
  if (proc.exitCode !== 0) return null;
  return proc.stdout.toString().trim();
}
