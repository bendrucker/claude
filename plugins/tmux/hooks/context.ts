#!/usr/bin/env bun

import { join } from "node:path";

const FORMAT = [
  "export TMUX_SESSION_NAME='#{session_name}'",
  "export TMUX_WINDOW_INDEX='#{window_index}'",
  "export TMUX_WINDOW_NAME='#{window_name}'",
  "export TMUX_PANE_INDEX='#{pane_index}'",
  "export TMUX_PANE='#{pane_id}'",
].join("\n");

function hookAsset(name: string): string {
  const root = process.env.CLAUDE_PLUGIN_ROOT;
  if (root) return join(root, "hooks", name);
  return join(import.meta.dirname, name);
}

function scriptPath(name: string): string {
  const root = process.env.CLAUDE_PLUGIN_ROOT;
  if (root) return join(root, "skills/tmux/scripts", name);
  return join(import.meta.dirname, "..", "skills/tmux/scripts", name);
}

async function loadDirective(): Promise<string | null> {
  try {
    return (await Bun.file(hookAsset("prompt.md")).text()).trimEnd();
  } catch {
    return null;
  }
}

async function runScript(name: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(["bash", scriptPath(name)], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const output = await new Response(proc.stdout).text();
    if ((await proc.exited) !== 0) return null;
    return output.trimEnd();
  } catch {
    return null;
  }
}

async function writeEnvFile(envFile: string, pane: string): Promise<void> {
  try {
    const proc = Bun.spawn(["tmux", "display-message", "-t", pane, "-p", FORMAT], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const output = await new Response(proc.stdout).text();
    if ((await proc.exited) !== 0) return;

    const file = Bun.file(envFile);
    const existing = (await file.exists()) ? await file.text() : "";
    await Bun.write(file, existing + output);
  } catch {
    // Env file write is best-effort: don't let it abort context injection.
  }
}

const PREAMBLE =
  "You are running inside a tmux session. The user is attached to this session and can see your pane and the surrounding panes in real time. Your terminal is not an isolated process.";

function buildContext(
  pane: string | null,
  layout: string | null,
  directive: string | null,
): string {
  const sections = [PREAMBLE];
  if (pane) sections.push(`<tmux-pane>\n${pane}\n</tmux-pane>`);
  if (layout) sections.push(`<tmux-layout>\n${layout}\n</tmux-layout>`);
  if (directive) sections.push(directive);
  return sections.join("\n\n");
}

async function main(): Promise<void> {
  const pane = process.env.TMUX_PANE;
  if (!process.env.TMUX || !pane || !process.env.CLAUDE_ENV_FILE) return;

  const [paneOutput, layoutOutput, directive] = await Promise.all([
    runScript("pane.sh"),
    runScript("layout.sh"),
    loadDirective(),
    writeEnvFile(process.env.CLAUDE_ENV_FILE, pane),
  ]);

  const response = {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: buildContext(paneOutput, layoutOutput, directive),
    },
  };

  process.stdout.write(`${JSON.stringify(response)}\n`);
}

if (import.meta.main) {
  main().catch(console.error);
}
