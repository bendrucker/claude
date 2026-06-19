#!/usr/bin/env bun

import { cli } from "cleye";
import { markDispatched, resetDispatched } from "./store";

// Record that a babysit watcher was dispatched for a PR/MR so the feed stops
// re-emitting it, or reset the set at the start of a fresh hands-off session.
cli(
  {
    name: "dispatch",
    parameters: ["[url]"],
    flags: {
      dataDir: { type: String, description: "Data directory (defaults to CLAUDE_PLUGIN_DATA)" },
      reset: { type: Boolean, description: "Clear all dispatched URLs and exit", default: false },
    },
  },
  async (argv) => {
    if (argv.flags.reset) {
      await resetDispatched(argv.flags.dataDir);
      return;
    }
    const url = argv._.url;
    if (!url) throw new Error("a url is required (or pass --reset)");
    await markDispatched(url, argv.flags.dataDir);
  },
);
