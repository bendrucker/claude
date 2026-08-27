#!/usr/bin/env bun

import { join } from "node:path";
import { tmuxQuery } from "./tmux";
import { xml } from "./xml";

const ENV_FORMAT = [
  "export TMUX_SESSION_NAME='#{session_name}'",
  "export TMUX_WINDOW_INDEX='#{window_index}'",
  "export TMUX_WINDOW_NAME='#{window_name}'",
  "export TMUX_PANE_INDEX='#{pane_index}'",
  "export TMUX_PANE='#{pane_id}'",
].join("\n");

function hookAsset(name: string): string {
  const root = process.env.CLAUDE_PLUGIN_ROOT;
  if (root != null && root !== "") return join(root, "hooks", name);
  return join(import.meta.dirname, name);
}

function scriptPath(name: string): string {
  const root = process.env.CLAUDE_PLUGIN_ROOT;
  if (root != null && root !== "") return join(root, "skills/tmux/scripts", name);
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

function isSessionAttached(pane: string): boolean {
  return tmuxQuery("display-message", "-t", pane, "-p", "#{session_attached}") === "1";
}

async function writeEnvFile(envFile: string, pane: string): Promise<void> {
  try {
    const output = tmuxQuery("display-message", "-t", pane, "-p", ENV_FORMAT);
    if (output == null || output === "") return;

    const file = Bun.file(envFile);
    const existing = (await file.exists()) ? await file.text() : "";
    await Bun.write(file, existing + output);
  } catch {
    // best-effort
  }
}

const PREAMBLE = "You are running inside a tmux session.";

function buildContext(
  attached: boolean,
  pane: string | null,
  window: string | null,
  directive: string | null,
): string {
  const sections = [PREAMBLE];

  const children: string[] = [];
  if (pane != null && pane !== "") children.push(xml("pane", pane));
  if (window != null && window !== "") children.push(xml("window", window));
  if (children.length > 0) {
    sections.push(xml("tmux", { attached }, children.join("\n\n")));
  }

  if (directive != null && directive !== "") sections.push(directive);
  return sections.join("\n\n");
}

async function main(): Promise<void> {
  const pane = process.env.TMUX_PANE;
  if (
    process.env.TMUX == null ||
    process.env.TMUX === "" ||
    pane == null ||
    pane === "" ||
    process.env.CLAUDE_ENV_FILE == null ||
    process.env.CLAUDE_ENV_FILE === ""
  )
    return;

  const attached = isSessionAttached(pane);

  const [paneOutput, windowOutput, directive] = await Promise.all([
    runScript("pane.sh"),
    runScript("window.sh"),
    loadDirective(),
    writeEnvFile(process.env.CLAUDE_ENV_FILE, pane),
  ]);

  const response = {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: buildContext(attached, paneOutput, windowOutput, directive),
    },
  };

  process.stdout.write(`${JSON.stringify(response)}\n`);
}

if (import.meta.main) {
  main().catch(console.error);
}
