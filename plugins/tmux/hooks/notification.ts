#!/usr/bin/env bun

import { cli } from "cleye";
import { tmux, tmuxQuery } from "./tmux";

const argv = cli({
  name: "notification",
  flags: {
    backgroundOnly: {
      type: Boolean,
      description: "Only ring when the tmux window is in the background",
      default: false,
    },
    clear: {
      type: Boolean,
      description: "Clear the notification from the status bar",
      default: false,
    },
  },
});

function paneOptionKey(pane: string): string {
  return `@claude_notification_${pane.replace("%", "")}`;
}

interface NotificationEntry {
  window: string;
  tool: string;
}

function parseEntry(raw: string): NotificationEntry | null {
  const [window, tool] = raw.split(":");
  if (!window || !tool) return null;
  return { window, tool };
}

function maxToolLength(): number {
  const width = Number(tmuxQuery("display-message", "-p", "#{client_width}") ?? "120");
  return Math.max(4, Math.min(12, Math.floor(width / 16)));
}

function truncate(str: string, max: number): string {
  return str.length <= max ? str : `${str.slice(0, max - 1)}…`;
}

function updateSummary(): void {
  const output = tmuxQuery("show-options", "-g");
  if (!output) return;

  const entries: NotificationEntry[] = [];
  for (const line of output.split("\n")) {
    const match = line.match(/^@claude_notification_\d+ "?(.+?)"?$/);
    if (match) {
      const entry = parseEntry(match[1]!);
      if (entry) entries.push(entry);
    }
  }

  if (entries.length === 0) {
    tmux("set-option", "-gu", "@claude_notification");
    return;
  }

  const toolMax = maxToolLength();
  const first = entries[0]!;
  let text = `${first.window}:${truncate(first.tool, toolMax)}`;
  if (entries.length > 1) {
    text += ` (+${entries.length - 1})`;
  }

  // ANSI colours 0-15 are remapped by the terminal's Catppuccin theme, so the
  // status segment adapts to light and dark mode (see scripts.md).
  const accent = "colour3";
  const crust = "colour0";
  const fg = "colour7";
  const surface = "colour8";
  const sep = "\uE0B6";

  const styled = [
    `#[fg=${accent}]${sep}`,
    `#[fg=${crust},bg=${accent}]󰂞 `,
    `#[fg=${fg},bg=${surface}] ${text}`,
    `#[fg=${surface}] `,
  ].join("");

  tmux("set-option", "-g", "@claude_notification", styled);
}

interface HookInput {
  notification_type?: string;
  message?: string;
}

async function readHookInput(): Promise<HookInput | null> {
  const text = await Bun.stdin.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    console.error(
      `[tmux/notification] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

async function main(): Promise<void> {
  if (!process.env.TMUX) return;
  const pane = process.env.TMUX_PANE ?? tmuxQuery("display-message", "-p", "#{pane_id}");
  if (!pane) return;

  // hooks.json wraps the --clear invocation in an inline shell guard that
  // skips the bun startup entirely when this pane has no notification marker,
  // so this arm only runs when there is actually something to clear.
  if (argv.flags.clear) {
    tmux("set-option", "-gu", paneOptionKey(pane));
    updateSummary();
    return;
  }

  const paneInfo = tmuxQuery(
    "display-message",
    "-p",
    "-t",
    pane,
    "#{pane_tty}\n#{window_index}\n#{window_active}",
  );
  if (!paneInfo) return;

  const [tty, window, active] = paneInfo.split("\n");
  if (!tty || !window || !active) return;

  if (argv.flags.backgroundOnly && active === "1") return;

  if (argv.flags.backgroundOnly) {
    tmux("set-option", "-gu", paneOptionKey(pane));
    updateSummary();
  } else {
    const input = await readHookInput();
    if (input?.notification_type === "permission_prompt") {
      const tool = input.message?.match(/use (\w+)/)?.[1] ?? "input";
      tmux("set-option", "-g", paneOptionKey(pane), `${window}:${tool}`);
      updateSummary();
    }
  }

  try {
    await Bun.write(tty, "\x07");
  } catch (error) {
    console.error(
      `[tmux/notification] Failed to write bell to ${tty}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
