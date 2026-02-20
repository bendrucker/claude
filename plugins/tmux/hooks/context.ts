#!/usr/bin/env bun

import { appendFile } from "node:fs/promises";

const FORMAT_VARS = [
  ["TMUX_SESSION_NAME", "#{session_name}"],
  ["TMUX_WINDOW_INDEX", "#{window_index}"],
  ["TMUX_WINDOW_NAME", "#{window_name}"],
  ["TMUX_PANE_INDEX", "#{pane_index}"],
  ["TMUX_PANE_ID", "#{pane_id}"],
] as const;

const DELIMITER = "\x1f";

export function buildFormat(): string {
  return FORMAT_VARS.map(([, fmt]) => fmt).join(DELIMITER);
}

export function buildExports(output: string): string {
  const values = output.trim().split(DELIMITER);
  return `${FORMAT_VARS.map(([name], i) => `export ${name}=${quote(values[i] ?? "")}`).join("\n")}\n`;
}

function quote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

async function main(): Promise<void> {
  if (!process.env.TMUX) return;

  const envFile = process.env.CLAUDE_ENV_FILE;
  if (!envFile) return;

  const proc = Bun.spawn(["tmux", "display-message", "-p", buildFormat()], {
    stdout: "pipe",
    stderr: "ignore",
  });

  const output = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) return;

  await appendFile(envFile, buildExports(output));
}

if (import.meta.main) {
  main().catch(console.error);
}
