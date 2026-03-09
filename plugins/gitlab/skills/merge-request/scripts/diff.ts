import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

export type DiffRefs = { base_sha: string; head_sha: string; start_sha: string };

export async function getDiffRefs(iid: number | string): Promise<DiffRefs> {
  const result = await $`glab api projects/:id/merge_requests/${iid} | jq '.diff_refs'`.json();
  return result as DiffRefs;
}

export type Hunk = {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
};

export function parseDiffHunks(diff: string): Hunk[] {
  const hunks: Hunk[] = [];
  const regex = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm;
  for (const match of diff.matchAll(regex)) {
    hunks.push({
      oldStart: Number(match[1]),
      oldCount: match[2] !== undefined ? Number(match[2]) : 1,
      newStart: Number(match[3]),
      newCount: match[4] !== undefined ? Number(match[4]) : 1,
    });
  }
  return hunks;
}

export function isLineInDiff(hunks: Hunk[], line: number, side: "new" | "old"): boolean {
  for (const hunk of hunks) {
    const start = side === "new" ? hunk.newStart : hunk.oldStart;
    const count = side === "new" ? hunk.newCount : hunk.oldCount;
    if (line >= start && line < start + count) return true;
  }
  return false;
}

type MrDiff = {
  old_path: string;
  new_path: string;
  diff: string;
};

export async function fetchMrDiffs(iid: number | string): Promise<MrDiff[]> {
  const result = await $`glab api projects/:id/merge_requests/${iid}/diffs`.json();
  return result as MrDiff[];
}

export function validateLineInDiff(
  diffs: MrDiff[],
  file: string,
  opts: { line?: number | undefined; oldLine?: number | undefined },
): void {
  const fileDiff = diffs.find((d) => d.new_path === file || d.old_path === file);
  if (!fileDiff) {
    throw new Error(`File ${file} not found in MR diff`);
  }

  const hunks = parseDiffHunks(fileDiff.diff);

  if (opts.oldLine !== undefined) {
    if (!isLineInDiff(hunks, opts.oldLine, "old")) {
      const ranges = hunks.map((h) => `${h.oldStart}-${h.oldStart + h.oldCount - 1}`).join(", ");
      throw new Error(
        `Old line ${opts.oldLine} of ${file} is not within a diff hunk. Valid old-line ranges: ${ranges}`,
      );
    }
  } else if (opts.line !== undefined) {
    if (!isLineInDiff(hunks, opts.line, "new")) {
      const ranges = hunks.map((h) => `${h.newStart}-${h.newStart + h.newCount - 1}`).join(", ");
      throw new Error(
        `Line ${opts.line} of ${file} is not within a diff hunk. Valid new-line ranges: ${ranges}`,
      );
    }
  }
}

export type Position = {
  base_sha: string;
  head_sha: string;
  start_sha: string;
  old_path: string;
  new_path: string;
  position_type: "text";
  old_line?: number;
  new_line?: number;
};

export function buildPosition(
  refs: DiffRefs,
  path: string,
  opts: { line?: number | undefined; oldLine?: number | undefined },
): Position {
  const position: Position = {
    ...refs,
    old_path: path,
    new_path: path,
    position_type: "text",
  };

  if (opts.oldLine !== undefined) {
    position.old_line = opts.oldLine;
  } else if (opts.line !== undefined) {
    position.new_line = opts.line;
  }

  return position;
}

export async function readBody(file: string | undefined): Promise<string> {
  if (file === "-" || !file) {
    return await Bun.stdin.text();
  }
  return await Bun.file(file).text();
}

export async function glabApiPost(path: string, payload: Record<string, unknown>): Promise<void> {
  const tmpFile = join(tmpdir(), `glab-api-${randomUUID()}.json`);
  await Bun.write(tmpFile, JSON.stringify(payload));
  try {
    const result =
      await $`glab api ${path} -X POST -H "Content-Type: application/json" --input ${tmpFile}`.text();
    console.log(result);
  } finally {
    await Bun.file(tmpFile).unlink();
  }
}
