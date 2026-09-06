#!/usr/bin/env bun

import { cli } from "cleye";
import { z } from "zod";
import { readState } from "./store";

const Queue = z.array(z.looseObject({ url: z.string() }));

export type FetchResult = { ok: true; urls: string[] } | { ok: false; reason: string };

// Run a review-queue command that prints a JSON array of `{ url }` and return
// a discriminated result. A failed command (network, auth, an unconfigured
// source) is reported via ok:false so callers can emit a visible error; the
// caller decides whether to treat a failure as zero URLs.
export async function fetchUrls(command: string): Promise<FetchResult> {
  const proc = Bun.spawn(["sh", "-c", command], { stdout: "pipe", stderr: "pipe" });
  const [exit, stdoutText, stderrText] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if (exit !== 0) {
    const detail = stderrText.trim();
    return { ok: false, reason: detail !== "" ? detail : `exited with code ${exit}` };
  }
  try {
    const entries = Queue.parse(JSON.parse(stdoutText));
    return { ok: true, urls: entries.map((entry) => entry.url) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `JSON parse failed: ${message}` };
  }
}

// New reviews are the fetched URLs not already dispatched, deduped across
// sources and kept in fetch order.
export function newUrls(fetched: string[], dispatched: ReadonlySet<string>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const url of fetched) {
    if (dispatched.has(url) || seen.has(url)) continue;
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

  const dispatched = new Set((await readState(argv.flags.dataDir)).dispatched.map((d) => d.url));

  const results = await Promise.all(argv.flags.queue.map(fetchUrls));
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (!result) continue;
    if (!result.ok) {
      console.error(
        JSON.stringify({
          type: "source-error",
          source: argv.flags.queue[i],
          detail: result.reason,
        }),
      );
    }
  }
  const fetched = results.flatMap((r) => (r.ok ? r.urls : []));

  for (const url of newUrls(fetched, dispatched)) {
    console.log(url);
  }
}
