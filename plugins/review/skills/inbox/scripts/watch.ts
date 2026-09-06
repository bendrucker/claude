#!/usr/bin/env bun

import { cli } from "cleye";
import { fetchUrls, newUrls } from "./poll";
import { readState } from "./store";

async function iteration(queues: string[], dataDir: string | undefined): Promise<void> {
  const state = await readState(dataDir);
  const dispatched = new Set(state.dispatched.map((d) => d.url));
  const results = await Promise.all(queues.map(fetchUrls));

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (!result) continue;
    if (!result.ok) {
      console.error(
        JSON.stringify({ type: "source-error", source: queues[i], detail: result.reason }),
      );
    }
  }

  const fetched = results.flatMap((r) => (r.ok ? r.urls : []));
  for (const url of newUrls(fetched, dispatched)) {
    console.log(url);
  }
}

const argv = cli({
  name: "watch",
  flags: {
    dataDir: { type: String, description: "Data directory (defaults to CLAUDE_PLUGIN_DATA)" },
    queue: {
      type: [String],
      description: "Review-queue command emitting [{ url }] JSON; repeat once per platform source",
    },
    interval: {
      type: Number,
      description: "Poll interval in seconds",
      default: 300,
    },
  },
});

const { dataDir, queue: queues, interval } = argv.flags;

// Run immediately on start, then loop with an internal sleep so
// Monitor sees a single long-lived process (no shell while/sleep loop, which
// breaks on macOS due to PATH-stripped eval and nice(5) restrictions).
while (true) {
  // oxlint-disable-next-line no-await-in-loop -- poll loop: the next iteration only runs after this one finishes.
  await iteration(queues, dataDir);
  // oxlint-disable-next-line no-await-in-loop -- poll interval between iterations.
  await Bun.sleep(interval * 1000);
}
