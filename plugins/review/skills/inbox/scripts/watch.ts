#!/usr/bin/env bun

import { Command, InvalidArgumentError } from "@commander-js/extra-typings";
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

function number(value: string): number {
  const n = Number(value);
  if (Number.isNaN(n)) throw new InvalidArgumentError("Not a number.");
  return n;
}

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

export const program = new Command("watch")
  .option("--data-dir <dir>", "Data directory (defaults to CLAUDE_PLUGIN_DATA)")
  .option(
    "--queue <command>",
    "Review-queue command emitting [{ url }] JSON; repeat once per platform source",
    collect,
    [],
  )
  .option("--interval <seconds>", "Poll interval in seconds", number, 300)
  .action(async (flags) => {
    const { dataDir, queue: queues, interval } = flags;

    // Run immediately on start, then loop with an internal sleep so
    // Monitor sees a single long-lived process (no shell while/sleep loop, which
    // breaks on macOS due to PATH-stripped eval and nice(5) restrictions).
    while (true) {
      // oxlint-disable-next-line no-await-in-loop -- poll loop: the next iteration only runs after this one finishes.
      await iteration(queues, dataDir);
      // oxlint-disable-next-line no-await-in-loop -- poll interval between iterations.
      await Bun.sleep(interval * 1000);
    }
  });

if (import.meta.main) {
  await program.parseAsync();
}
