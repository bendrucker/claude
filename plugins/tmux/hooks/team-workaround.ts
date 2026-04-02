#!/usr/bin/env bun

// Workaround for https://github.com/anthropics/claude-code/issues/23513
//
// Agent team tmux panes fail because send-keys fires before zsh finishes
// loading .zshrc. We override default-command with a wrapper script that
// checks a per-window option (@claude_fast_shell). Windows with the option
// get instant bash; all other windows fall through to a normal login shell.

import { join } from "node:path";
import { cli } from "cleye";
import { tmux, tmuxQuery } from "./tmux";

const argv = cli({
  name: "team-workaround",
  flags: {
    setup: {
      type: Boolean,
      description: "Override default-command for fast pane startup",
      default: false,
    },
    teardown: {
      type: Boolean,
      description: "Restore original default-command",
      default: false,
    },
  },
});

const SAVED_KEY = "@claude_original_default_command";
const SAVED_SENTINEL = "@claude_default_command_overridden";
const WINDOW_KEY = "@claude_fast_shell";
const WRAPPER_PATH = join(import.meta.dirname, "shell-wrapper.sh");

export function setup(): void {
  const alreadyOverridden = tmuxQuery("show-option", "-v", SAVED_SENTINEL);
  if (alreadyOverridden === "1") return;

  const current = tmuxQuery("show-option", "-v", "default-command");
  if (current) {
    tmux("set-option", SAVED_KEY, current);
  }
  tmux("set-option", SAVED_SENTINEL, "1");

  tmux("set-environment", "CLAUDE_PATH", process.env.PATH ?? "");
  tmux("set-option", "default-command", WRAPPER_PATH);
  tmux("set-option", "-w", WINDOW_KEY, "1");
}

export function teardown(): void {
  const overridden = tmuxQuery("show-option", "-v", SAVED_SENTINEL);
  if (overridden !== "1") return;

  const original = tmuxQuery("show-option", "-v", SAVED_KEY);
  if (original) {
    tmux("set-option", "default-command", original);
  } else {
    tmux("set-option", "-u", "default-command");
  }

  tmux("set-option", "-u", SAVED_KEY);
  tmux("set-option", "-u", SAVED_SENTINEL);
  tmux("set-option", "-wu", WINDOW_KEY);
  tmux("set-environment", "-r", "CLAUDE_PATH");
}

function main(): void {
  if (!process.env.TMUX) return;

  if (argv.flags.setup) {
    setup();
  } else if (argv.flags.teardown) {
    teardown();
  }
}

if (import.meta.main) {
  main();
}
