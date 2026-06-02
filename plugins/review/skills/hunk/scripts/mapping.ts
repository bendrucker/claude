import { cli, command } from "cleye";
import { type Anchor, type HunkNote, deriveAnchor } from "./note";

export type { Anchor, HunkNote } from "./note";

export type FileDiff = {
  newLines: Set<number>;
  oldLines: Set<number>;
  oldPath?: string;
};

export type ParsedDiff = Map<string, FileDiff>;

const GIT_HEADER = /^diff --git a\/(.+) b\/(.+)$/;
const RENAME_FROM = /^rename from (.+)$/;
const RENAME_TO = /^rename to (.+)$/;
const OLD_PATH = /^--- (?:a\/)?(.+)$/;
const NEW_PATH = /^\+\+\+ (?:b\/)?(.+)$/;
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function stripDevNull(path: string): string | undefined {
  return path === "/dev/null" ? undefined : path;
}

/**
 * Parse a standard unified diff into per-file line sets.
 *
 * `newLines` holds every new-side line number present within a hunk (added or
 * context); `oldLines` holds every old-side line number present within a hunk
 * (removed or context). These sets are the source of truth for the in-diff
 * pre-check that prevents GitHub's 422 "Line could not be resolved".
 *
 * The parser tracks an explicit `inHunk` flag so that header-shaped body lines
 * (an added `+++ foo` or a deleted `--- foo`) are classified by their leading
 * character rather than mistaken for file headers.
 */
export function parseDiff(diffText: string): ParsedDiff {
  const files: ParsedDiff = new Map();
  let current: FileDiff | undefined;
  let currentKey: string | undefined;
  let renameFrom: string | undefined;
  let inHunk = false;
  let newLine = 0;
  let oldLine = 0;

  const lines = diffText.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  function rename(toPath: string): void {
    if (!current) return;
    if (currentKey && currentKey !== toPath) {
      files.delete(currentKey);
      files.set(toPath, current);
      currentKey = toPath;
    }
  }

  for (const line of lines) {
    if (inHunk) {
      const firstChar = line[0];
      if (firstChar === "+") {
        current?.newLines.add(newLine);
        newLine++;
        continue;
      }
      if (firstChar === "-") {
        current?.oldLines.add(oldLine);
        oldLine++;
        continue;
      }
      if (firstChar === " ") {
        current?.newLines.add(newLine);
        current?.oldLines.add(oldLine);
        newLine++;
        oldLine++;
        continue;
      }
      if (firstChar === "\\") {
        // "\ No newline at end of file" marker; not a real line.
        continue;
      }
      if (line === "") {
        // Trailing split artifact from a newline-terminated diff. A real empty
        // context line is " " (leading space) and is handled above.
        continue;
      }
      // Anything else (diff --git, @@, ---/+++ of the next file) ends the hunk
      // and falls through to the header logic below.
      inHunk = false;
    }

    const gitMatch = GIT_HEADER.exec(line);
    if (gitMatch) {
      const newPath = gitMatch[2];
      currentKey = newPath;
      current = { newLines: new Set(), oldLines: new Set() };
      if (gitMatch[1] !== gitMatch[2]) current.oldPath = gitMatch[1];
      files.set(currentKey, current);
      renameFrom = undefined;
      continue;
    }

    const renameFromMatch = RENAME_FROM.exec(line);
    if (renameFromMatch) {
      renameFrom = renameFromMatch[1];
      if (current) current.oldPath = renameFrom;
      continue;
    }

    const renameToMatch = RENAME_TO.exec(line);
    if (renameToMatch && current) {
      rename(renameToMatch[1]);
      if (renameFrom) current.oldPath = renameFrom;
      continue;
    }

    if (line.startsWith("--- ")) {
      const oldMatch = OLD_PATH.exec(line);
      if (oldMatch && current) {
        const oldPath = stripDevNull(oldMatch[1]);
        if (oldPath && currentKey && oldPath !== currentKey) current.oldPath = oldPath;
      }
      continue;
    }

    if (line.startsWith("+++ ")) {
      const newMatch = NEW_PATH.exec(line);
      if (newMatch && current) {
        const newPath = stripDevNull(newMatch[1]);
        if (newPath && currentKey && newPath !== currentKey) {
          if (current.oldPath === undefined) {
            current.oldPath = currentKey;
          }
          rename(newPath);
        }
      }
      continue;
    }

    const hunkMatch = HUNK_HEADER.exec(line);
    if (hunkMatch) {
      oldLine = Number(hunkMatch[1]);
      newLine = Number(hunkMatch[3]);
      inHunk = true;
      continue;
    }
  }

  return files;
}

/**
 * Resolve a note's anchor. Thin wrapper over the shared `deriveAnchor` so
 * existing imports of `noteAnchor` keep working.
 */
export function noteAnchor(note: HunkNote): Anchor {
  return deriveAnchor(note);
}

export type ValidationResult = { ok: true } | { ok: false; reason: string };

/**
 * Pre-check that a note's anchor lands on a line the platform will accept.
 * Hunk allows anchoring on unchanged context lines outside the diff, which
 * GitHub rejects with 422 "Line could not be resolved".
 */
export function validateInDiff(note: HunkNote, parsed: ParsedDiff): ValidationResult {
  const anchor = noteAnchor(note);
  const fileDiff = parsed.get(anchor.path);
  if (!fileDiff) {
    return { ok: false, reason: `File ${anchor.path} is not in the diff` };
  }

  const lineSet = anchor.side === "new" ? fileDiff.newLines : fileDiff.oldLines;
  if (!lineSet.has(anchor.line)) {
    return {
      ok: false,
      reason: `${anchor.side === "new" ? "New" : "Old"}-side line ${anchor.line} of ${anchor.path} is not within a diff hunk`,
    };
  }

  return { ok: true };
}

export type GitHubComment = {
  path: string;
  line: number;
  side: "RIGHT" | "LEFT";
  commit_id: string;
  body: string;
};

/** Map a note to a GitHub review-comment payload. new-side -> RIGHT, old-side -> LEFT. */
export function toGitHubComment(note: HunkNote, opts: { commitId: string }): GitHubComment {
  const anchor = noteAnchor(note);
  return {
    path: anchor.path,
    line: anchor.line,
    side: anchor.side === "new" ? "RIGHT" : "LEFT",
    commit_id: opts.commitId,
    body: note.body,
  };
}

export type GitLabRefs = {
  base_sha: string;
  head_sha: string;
  start_sha: string;
};

export type GitLabPosition = {
  position_type: "text";
  base_sha: string;
  head_sha: string;
  start_sha: string;
  new_path: string;
  old_path: string;
  new_line?: number;
  old_line?: number;
};

/**
 * Map a note to a GitLab discussion `position`. Sets `new_line` for new-side
 * anchors and `old_line` for old-side. `old_path` defaults to `new_path` when
 * the file is not a rename.
 */
export function toGitLabPosition(
  note: HunkNote,
  refs: GitLabRefs,
  opts: { newPath: string; oldPath?: string },
): GitLabPosition {
  const anchor = noteAnchor(note);
  const position: GitLabPosition = {
    position_type: "text",
    base_sha: refs.base_sha,
    head_sha: refs.head_sha,
    start_sha: refs.start_sha,
    new_path: opts.newPath,
    old_path: opts.oldPath ?? opts.newPath,
  };

  if (anchor.side === "new") {
    position.new_line = anchor.line;
  } else {
    position.old_line = anchor.line;
  }

  return position;
}

function readNotes(raw: string): HunkNote[] {
  const data = JSON.parse(raw) as { comments: HunkNote[] } | HunkNote[];
  return Array.isArray(data) ? data : data.comments;
}

const mapCmd = command(
  {
    name: "map",
    flags: {
      platform: { type: String, description: "Target platform: github or gitlab" },
      notes: { type: String, description: "Path to notes JSON ({comments:[...]} or [...])" },
      diff: { type: String, description: "Path to unified diff text" },
      commit: { type: String, description: "Head commit SHA" },
      base: { type: String, description: "Base SHA (gitlab)" },
      start: { type: String, description: "Start SHA (gitlab)" },
    },
  },
  async (parsed) => {
    const { platform, notes, diff, commit, base, start } = parsed.flags;

    if (platform !== "github" && platform !== "gitlab") {
      console.error("--platform must be github or gitlab");
      process.exit(1);
    }
    if (!notes || !diff || !commit) {
      console.error("--notes, --diff, and --commit are required");
      process.exit(1);
    }
    if (platform === "gitlab" && (!base || !start)) {
      console.error("gitlab requires --base and --start");
      process.exit(1);
    }

    let noteList: HunkNote[];
    let diffText: string;
    try {
      noteList = readNotes(await Bun.file(notes).text());
      diffText = await Bun.file(diff).text();
    } catch (error) {
      console.error((error as Error).message);
      process.exit(1);
    }

    const parsedDiff = parseDiff(diffText);
    const payloads: unknown[] = [];
    const dropped: { noteId: string; reason: string }[] = [];

    for (const note of noteList) {
      const result = validateInDiff(note, parsedDiff);
      if (!result.ok) {
        dropped.push({ noteId: note.noteId, reason: result.reason });
        continue;
      }
      if (platform === "github") {
        payloads.push(toGitHubComment(note, { commitId: commit }));
      } else {
        const fileDiff = parsedDiff.get(note.filePath);
        const position = toGitLabPosition(
          note,
          { base_sha: base as string, head_sha: commit, start_sha: start as string },
          { newPath: note.filePath, oldPath: fileDiff?.oldPath },
        );
        payloads.push({ body: note.body, position });
      }
    }

    console.log(JSON.stringify({ platform, payloads, dropped }, null, 2));
  },
);

if (import.meta.main) {
  cli({
    name: "mapping",
    commands: [mapCmd],
  });
}
