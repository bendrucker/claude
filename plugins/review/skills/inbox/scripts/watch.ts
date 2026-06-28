#!/usr/bin/env bun

import { join } from "node:path";
import { cli } from "cleye";
import { fetchUrls, newUrls } from "./poll";
import { readState } from "./store";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const stateScript = join(import.meta.dirname, "state.ts");

async function runSync(dataDir: string | undefined): Promise<void> {
  const args = ["bun", stateScript, "sync"];
  if (dataDir) args.push("--data-dir", dataDir);
  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const [exit, stderrText] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  if (exit !== 0) {
    console.error(
      JSON.stringify({
        type: "sync-error",
        detail: stderrText.trim() || `exited with code ${exit}`,
      }),
    );
  }
}

async function iteration(queues: string[], dataDir: string | undefined): Promise<void> {
  await runSync(dataDir);

  const state = await readState(dataDir);
  const tracked = new Set(state.reviews.map((r) => r.url));
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
  for (const url of newUrls(fetched, tracked)) {
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

// Run immediately on start, then loop with an internal setTimeout sleep so
// Monitor sees a single long-lived process (no shell while/sleep loop, which
// breaks on macOS due to PATH-stripped eval and nice(5) restrictions).
while (true) {
  await iteration(queues, dataDir);
  await sleep(interval * 1000);
}
