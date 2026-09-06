#!/usr/bin/env bun
// Emit one event line per new comment in a tuicr review session; exit when the session goes away.
// Designed to run under the Monitor tool, so each line flushes as it is printed.
//
// tuicr has no push stream, so this polls `tuicr review comments` and tracks seen comment IDs
// (tuicr's stable per-comment key) rather than a timestamp, so it never drops or re-fires a
// comment, even two created in the same second.

import { cli } from "cleye";
import { decodeComments, type TuicrComment } from "./comment";

/** Collapse whitespace runs so each comment prints on a single line. */
export function oneLine(content: string): string {
  return content.replaceAll(/\s+/g, " ").trim();
}

/** The Monitor event line for a freshly seen comment. */
export function describeComment(comment: Pick<TuicrComment, "location" | "content">): string {
  return `NEW ${comment.location} | ${oneLine(comment.content)}`;
}

/** Comments whose IDs are not yet in `seen` (skipping any without an ID, as tuicr never emits one). */
export function newComments(seen: Set<string>, comments: TuicrComment[]): TuicrComment[] {
  return comments.filter((comment) => comment.id !== "" && !seen.has(comment.id));
}

/**
 * Read the session's comments. Returns null when the session is gone: a non-zero exit (tuicr can no
 * longer resolve the slug) is the signal to stop, distinct from a readable session with no comments.
 */
export function readComments(repo: string, slug: string): TuicrComment[] | null {
  const result = Bun.spawnSync(["tuicr", "review", "comments", "--repo", repo, "--session", slug]);
  if (!result.success) return null;
  try {
    return decodeComments(result.stdout.toString());
  } catch {
    return null;
  }
}

async function watch(slug: string, repo: string, pollSeconds: number): Promise<void> {
  const seen = new Set<string>();

  // Arm: mark existing comments seen without announcing them.
  for (const comment of readComments(repo, slug) ?? []) {
    if (comment.id !== "") seen.add(comment.id);
  }
  console.log(`WATCHING ${slug}`);

  while (true) {
    const comments = readComments(repo, slug);
    if (comments === null) {
      console.log("SESSION CLOSED");
      return;
    }
    for (const comment of newComments(seen, comments)) {
      seen.add(comment.id);
      console.log(describeComment(comment));
    }
    // oxlint-disable-next-line no-await-in-loop -- poll interval between reads of the tuicr session.
    await Bun.sleep(pollSeconds * 1000);
  }
}

if (import.meta.main) {
  const argv = cli({
    name: "watch",
    parameters: ["<slug>", "[poll-seconds]"],
    flags: {
      repo: { type: String, default: ".", description: "Checkout path or owner/repo" },
    },
  });
  const pollSeconds =
    argv._.pollSeconds != null && argv._.pollSeconds !== "" ? Number(argv._.pollSeconds) : 30;
  await watch(argv._.slug, argv.flags.repo, pollSeconds);
}
