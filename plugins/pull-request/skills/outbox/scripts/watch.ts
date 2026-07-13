#!/usr/bin/env bun
// claude:dangerouslyDisableSandbox: queue sources shell out to gh/glab for TLS-bearing API calls

import { cli } from "cleye";
import { pollOnce } from "./poll";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const argv = cli({
  name: "watch",
  flags: {
    dataDir: { type: String, description: "Data directory (defaults to CLAUDE_PLUGIN_DATA)" },
    queue: {
      type: [String],
      description: "Queue command emitting ActionEntry[] JSON; repeat once per platform source",
    },
    interval: { type: Number, description: "Poll interval in seconds", default: 300 },
    staleDays: {
      type: Number,
      description: "Days of inactivity before green counts as stale",
      default: 2,
    },
  },
});

const dataDir = argv.flags.dataDir ?? process.env.CLAUDE_PLUGIN_DATA;
if (!dataDir) throw new Error("dataDir is required (or set CLAUDE_PLUGIN_DATA)");
const { queue: queues, interval, staleDays } = argv.flags;

// Run immediately on start, then loop with an internal setTimeout sleep so
// Monitor sees a single long-lived process. A shell while/sleep loop breaks on
// macOS due to PATH-stripped eval and nice(5) restrictions. Each printed URL is
// one newly-actionable PR/MR not yet dispatched a babysit watcher; that is the
// event the orchestrator reacts to.
//
// A transient I/O failure in a single pass (disk full, NFS hiccup, corrupt
// state file) must not end the session-long watch. Report it to stderr and keep
// looping so the next pass can recover.
while (true) {
  try {
    for (const url of await pollOnce(queues, dataDir, staleDays, new Date())) {
      console.log(url);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ type: "poll-error", detail: message }));
  }
  await sleep(interval * 1000);
}
