#!/usr/bin/env bun

import { cli } from "cleye";
import { readState } from "./store";

type QueueEntry = { url: string };

// Run a review-queue command that prints a JSON array of `{ url }` and return
// the URLs. The dashboard knows nothing about any platform: each source is just
// a command supplied by the caller. A failed command (network, auth, an
// unconfigured source) yields an empty list, so one source's outage never
// stalls the poll.
async function fetchUrls(command: string): Promise<string[]> {
  const proc = Bun.spawn(["sh", "-c", command], { stdout: "pipe", stderr: "pipe" });
  if ((await proc.exited) !== 0) {
    return [];
  }
  try {
    const entries = JSON.parse(await new Response(proc.stdout).text()) as QueueEntry[];
    return entries.map((entry) => entry.url);
  } catch {
    return [];
  }
}

// New reviews are the fetched URLs not already tracked, deduped across sources
// and kept in fetch order.
export function newUrls(fetched: string[], tracked: ReadonlySet<string>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const url of fetched) {
    if (tracked.has(url) || seen.has(url)) continue;
    seen.add(url);
    result.push(url);
  }
  return result;
}

if (import.meta.main) {
  const argv = cli({
    name: "poll",
    flags: {
      dataDir: { type: String, description: "Data directory (defaults to CLAUDE_PLUGIN_DATA)" },
      queue: {
        type: [String],
        description:
          "Review-queue command emitting [{ url }] JSON; repeat once per platform source",
      },
    },
  });

  const tracked = new Set(
    (await readState(argv.flags.dataDir)).reviews.map((review) => review.url),
  );
  const fetched = (await Promise.all(argv.flags.queue.map(fetchUrls))).flat();

  for (const url of newUrls(fetched, tracked)) {
    console.log(url);
  }
}
