#!/usr/bin/env bun

const FORMAT = [
  "export TMUX_SESSION_NAME='#{session_name}'",
  "export TMUX_WINDOW_INDEX='#{window_index}'",
  "export TMUX_WINDOW_NAME='#{window_name}'",
  "export TMUX_PANE_INDEX='#{pane_index}'",
  "export TMUX_PANE='#{pane_id}'",
].join("\n");

async function main(): Promise<void> {
  const pane = process.env.TMUX_PANE;
  if (!process.env.TMUX || !pane || !process.env.CLAUDE_ENV_FILE) return;

  const proc = Bun.spawn(["tmux", "display-message", "-t", pane, "-p", FORMAT], {
    stdout: "pipe",
    stderr: "ignore",
  });

  const output = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0) return;

  const envFile = Bun.file(process.env.CLAUDE_ENV_FILE);
  const existing = (await envFile.exists()) ? await envFile.text() : "";
  await Bun.write(envFile, existing + output);
}

if (import.meta.main) {
  main().catch(console.error);
}
