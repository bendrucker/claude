#!/usr/bin/env bun

import { cli } from "cleye";
import { currentPane, tmuxSync } from "./tmux";
import { getTrackedPane, registerPane } from "./tracking";

const argv = cli({
  name: "dispatch",
  parameters: ["[subcommand]"],
  flags: {
    name: {
      type: String,
      description: "Name for the tracked pane",
      alias: "n",
    },
    split: {
      type: String,
      description: "Split direction: h (horizontal) or v (vertical)",
      default: "h",
    },
    size: {
      type: Number,
      description: "Size of new pane as percentage",
      default: 50,
    },
    target: {
      type: String,
      description: "Target pane ID (default: $TMUX_PANE)",
    },
    lines: {
      type: Number,
      description: "Lines to capture (for capture subcommand)",
      default: 100,
    },
  },
});

const subcommand = argv._.subcommand;

if (subcommand === "capture") {
  if (!argv.flags.name) {
    console.error("--name is required for capture");
    process.exit(1);
  }

  const pane = getTrackedPane(argv.flags.name);
  if (!pane) {
    console.error(`No tracked pane named: ${argv.flags.name}`);
    process.exit(1);
  }

  if (!pane.alive) {
    console.error(`Pane ${argv.flags.name} (${pane.id}) is no longer alive`);
    process.exit(1);
  }

  const output = tmuxSync("capture-pane", "-p", "-t", pane.id, "-S", `-${argv.flags.lines}`);
  if (output !== null) {
    console.log(output);
  }
} else {
  if (!argv.flags.name) {
    console.error("--name is required");
    process.exit(1);
  }

  const target = argv.flags.target ?? currentPane();
  const restArgs = process.argv.slice(process.argv.indexOf("--") + 1);

  if (restArgs.length === 0 || !process.argv.includes("--")) {
    console.error(
      "Usage: dispatch.ts --name <name> [--split h|v] [--size <percent>] -- <command...>",
    );
    process.exit(1);
  }

  const commandStr = restArgs.join(" ");

  const paneId = tmuxSync(
    "split-window",
    `-${argv.flags.split}`,
    "-d",
    "-P",
    "-F",
    "#{pane_id}",
    "-t",
    target,
    "-l",
    `${argv.flags.size}%`,
    commandStr,
  );

  if (!paneId) {
    console.error("Failed to create pane");
    process.exit(1);
  }

  registerPane(argv.flags.name, paneId, { command: commandStr });

  const result = {
    name: argv.flags.name,
    id: paneId,
    command: commandStr,
    target,
  };

  console.log(JSON.stringify(result, null, 2));
}
