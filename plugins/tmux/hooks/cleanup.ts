#!/usr/bin/env bun

export const paneVariables = ["@claude_status"];

if (import.meta.main) {
  if (!process.env.TMUX) process.exit(0);

  for (const variable of paneVariables) {
    const proc = Bun.spawn(["tmux", "set", "-pu", variable], {
      stdout: "ignore",
      stderr: "ignore",
    });
    await proc.exited;
  }
}
