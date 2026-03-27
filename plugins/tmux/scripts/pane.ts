#!/usr/bin/env bun

import { cli } from "cleye";
import { table } from "table";
import { tmuxRun } from "./tmux";
import { getTrackedPane, getTrackedPanes, registerPane, unregisterPane } from "./tracking";

const argv = cli({
  name: "pane",
  parameters: ["<command>", "[name]"],
  flags: {
    id: {
      type: String,
      description: "Pane ID (for register)",
    },
    meta: {
      type: String,
      description: "JSON metadata (for register)",
    },
    json: {
      type: Boolean,
      description: "Output as JSON (for list)",
      default: false,
    },
  },
});

const command = argv._.command;
const name = argv._.name;

switch (command) {
  case "register": {
    if (!name) {
      console.error("Usage: pane.ts register <name> --id <pane_id> [--meta <json>]");
      process.exit(1);
    }
    if (!argv.flags.id) {
      console.error("--id is required for register");
      process.exit(1);
    }
    const meta = argv.flags.meta ? JSON.parse(argv.flags.meta) : {};
    registerPane(name, argv.flags.id, meta);
    const pane = getTrackedPane(name);
    console.log(JSON.stringify(pane, null, 2));
    break;
  }

  case "get": {
    if (!name) {
      console.error("Usage: pane.ts get <name>");
      process.exit(1);
    }
    const pane = getTrackedPane(name);
    if (!pane) {
      console.error(`No tracked pane named: ${name}`);
      process.exit(1);
    }
    console.log(JSON.stringify(pane, null, 2));
    break;
  }

  case "list": {
    const panes = getTrackedPanes();
    if (argv.flags.json) {
      console.log(JSON.stringify(panes, null, 2));
    } else if (panes.length === 0) {
      console.log("No tracked panes");
    } else {
      const headers = ["Name", "ID", "Alive", "Created"];
      const rows = panes.map((p) => [p.name, p.id, p.alive ? "yes" : "no", p.created.slice(0, 19)]);
      console.log(table([headers, ...rows]));
    }
    break;
  }

  case "dismiss": {
    if (!name) {
      console.error("Usage: pane.ts dismiss <name>");
      process.exit(1);
    }
    const pane = getTrackedPane(name);
    if (pane?.alive) {
      tmuxRun("kill-pane", "-t", pane.id);
    }
    unregisterPane(name);
    console.log(`Dismissed: ${name}`);
    break;
  }

  case "dismiss-all": {
    const panes = getTrackedPanes();
    for (const pane of panes) {
      if (pane.alive) {
        tmuxRun("kill-pane", "-t", pane.id);
      }
      unregisterPane(pane.name);
    }
    console.log(`Dismissed ${panes.length} pane(s)`);
    break;
  }

  default:
    console.error(`Unknown command: ${command}`);
    console.error("Commands: register, get, list, dismiss, dismiss-all");
    process.exit(1);
}
