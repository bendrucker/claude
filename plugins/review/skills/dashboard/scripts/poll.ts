#!/usr/bin/env bun

import { cli } from "cleye";
import { readState } from "./store";

type QueueEntry = { url: string };

// Run a command that prints a JSON array of `{ url }` and return the URLs. A
// failed fetch (network, auth, an unconfigured platform) yields an empty list
// so one platform's outage never stalls the poll.
async function fetchUrls(cmd: string[]): Promise<string[]> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
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

// New reviews are the fetched URLs not already tracked, deduped across platforms
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
      gitlabQueue: {
        type: String,
        description: "Path to the gitlab plugin's review-queue.ts (omit to poll GitHub only)",
      },
    },
  });

  const tracked = new Set(
    (await readState(argv.flags.dataDir)).reviews.map((review) => review.url),
  );
  const github = await fetchUrls([
    "gh",
    "search",
    "prs",
    "--review-requested=@me",
    "--state=open",
    "--json",
    "url",
  ]);
  const gitlab = argv.flags.gitlabQueue ? await fetchUrls(["bun", argv.flags.gitlabQueue]) : [];

  for (const url of newUrls([...github, ...gitlab], tracked)) {
    console.log(url);
  }
}
