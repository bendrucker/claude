#!/usr/bin/env bun

import { cli } from "cleye";
import { table } from "table";
import { completeReview, readState, removeReview, writeState } from "./store";

function getLivePaneIds(): Set<string> {
  const proc = Bun.spawnSync(["tmux", "list-panes", "-a", "-F", "#{pane_id}"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) {
    const stderr = proc.stderr.toString().trim();
    throw new Error(`tmux list-panes failed (exit ${proc.exitCode}): ${stderr}`);
  }
  return new Set(proc.stdout.toString().trim().split("\n"));
}

const argv = cli({
  name: "state",
  parameters: ["<command>"],
  flags: {
    url: { type: String, description: "PR/MR URL" },
    json: { type: Boolean, description: "Output as JSON", default: false },
    dataDir: {
      type: String,
      description: "Data directory for persistent state (defaults to CLAUDE_PLUGIN_DATA)",
    },
  },
});

const dataDir = argv.flags.dataDir;

const command = argv._.command;

switch (command) {
  case "init": {
    await writeState({ reviews: [] }, dataDir);
    console.log("State initialized");
    break;
  }

  case "list": {
    const state = await readState(dataDir);
    if (argv.flags.json) {
      console.log(JSON.stringify(state.reviews, null, 2));
    } else if (state.reviews.length === 0) {
      console.log("No tracked reviews");
    } else {
      const headers = ["Repo", "Status", "Pane", "Started"];
      const rows = state.reviews.map((r) => [
        r.repo,
        r.status,
        `${r.paneName} (${r.paneId})`,
        r.startedAt.slice(0, 19),
      ]);
      console.log(table([headers, ...rows]));
    }
    break;
  }

  case "remove": {
    const { url } = argv.flags;
    if (!url) {
      console.error("--url is required for remove");
      process.exit(1);
    }
    const state = await readState(dataDir);
    const removed = removeReview(state, url);
    await writeState(state, dataDir);
    console.log(`Removed ${removed} review(s)`);
    break;
  }

  case "sync": {
    const state = await readState(dataDir);
    const livePanes = getLivePaneIds();
    let updated = 0;
    for (const review of state.reviews) {
      if (review.status === "active" && !livePanes.has(review.paneId)) {
        completeReview(state, review.paneId);
        updated++;
      }
    }
    await writeState(state, dataDir);
    console.log(`Synced: ${updated} review(s) marked completed`);
    break;
  }

  default:
    console.error(`Unknown command: ${command}`);
    console.error("Commands: init, list, remove, sync");
    process.exit(1);
}
