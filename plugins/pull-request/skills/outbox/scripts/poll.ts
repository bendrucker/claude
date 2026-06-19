#!/usr/bin/env bun
// claude:dangerouslyDisableSandbox: queue sources shell out to gh/glab for TLS-bearing API calls

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { cli } from "cleye";
import { type ActionEntry, actionable, type RankBucket, type RankedEntry, rankQueue } from "./rank";
import { readDispatched } from "./store";

export type FetchResult = { ok: true; entries: ActionEntry[] } | { ok: false; reason: string };

// Run a queue command that prints a JSON array of ActionEntry and return a
// discriminated result. A failed command (network, auth, an unconfigured
// source) reports ok:false so the caller can emit a visible error and treat the
// source as contributing zero entries.
export async function fetchEntries(command: string): Promise<FetchResult> {
  const proc = Bun.spawn(["sh", "-c", command], { stdout: "pipe", stderr: "pipe" });
  const [exit, stdoutText, stderrText] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if (exit !== 0) {
    return { ok: false, reason: stderrText.trim() || `exited with code ${exit}` };
  }
  try {
    return { ok: true, entries: JSON.parse(stdoutText) as ActionEntry[] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `JSON parse failed: ${message}` };
  }
}

const BUCKET_LABEL: Record<RankBucket, string> = {
  "red-ci": "CI failing",
  "changes-requested": "changes requested",
  "stale-green": "stale (green)",
  "waiting-on-review": "awaiting review",
  draft: "draft",
  none: "—",
};

// Render the actionable slice as a GFM table for needs-action.md, top item
// first. The file is read back and presented to you, so it is markdown, not
// terminal output.
export function renderNeedsAction(ranked: RankedEntry[]): string {
  const rows = actionable(ranked);
  if (!rows.length) {
    return "# Needs action\n\nNothing needs you. Every open PR/MR is green, fresh, and unblocked.\n";
  }
  const header = "| Needs | CI | Review | Updated | PR |\n| --- | --- | --- | --- | --- |";
  const body = rows
    .map(
      (row) =>
        `| ${BUCKET_LABEL[row.bucket]} | ${row.ci} | ${row.review} | ${row.updatedAt.slice(0, 10)} | ${row.url} |`,
    )
    .join("\n");
  return `# Needs action\n\n${header}\n${body}\n`;
}

async function writeNeedsAction(ranked: RankedEntry[], dataDir: string): Promise<void> {
  const dir = join(dataDir, "pull-request-outbox");
  await mkdir(dir, { recursive: true });
  await Bun.write(join(dir, "needs-action.md"), renderNeedsAction(ranked));
}

// Fetch every queue source, surface source failures, and return the ranked
// union. Shared by poll (one-shot) and watch (loop).
export async function collect(
  queues: string[],
  staleDays: number,
  now: Date,
): Promise<RankedEntry[]> {
  const results = await Promise.all(queues.map(fetchEntries));
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result && !result.ok) {
      console.error(
        JSON.stringify({ type: "source-error", source: queues[i], detail: result.reason }),
      );
    }
  }
  const entries = results.flatMap((result) => (result?.ok ? result.entries : []));
  return rankQueue(entries, now, staleDays);
}

// One full pass: rank the queues, overwrite needs-action.md, and return the
// actionable URLs not already dispatched a babysit watcher this run.
export async function pollOnce(
  queues: string[],
  dataDir: string,
  staleDays: number,
  now: Date,
): Promise<string[]> {
  const ranked = await collect(queues, staleDays, now);
  await writeNeedsAction(ranked, dataDir);
  const dispatched = await readDispatched(dataDir);
  return actionable(ranked)
    .map((entry) => entry.url)
    .filter((url) => !dispatched.has(url));
}

if (import.meta.main) {
  const argv = cli({
    name: "poll",
    flags: {
      dataDir: { type: String, description: "Data directory (defaults to CLAUDE_PLUGIN_DATA)" },
      queue: {
        type: [String],
        description: "Queue command emitting ActionEntry[] JSON; repeat once per platform source",
      },
      staleDays: {
        type: Number,
        description: "Days of inactivity before green counts as stale",
        default: 2,
      },
    },
  });

  const dataDir = argv.flags.dataDir ?? process.env.CLAUDE_PLUGIN_DATA;
  if (!dataDir) throw new Error("dataDir is required (or set CLAUDE_PLUGIN_DATA)");

  for (const url of await pollOnce(argv.flags.queue, dataDir, argv.flags.staleDays, new Date())) {
    console.log(url);
  }
}
