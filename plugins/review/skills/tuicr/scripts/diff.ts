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
      const oldFromHeader = gitMatch[1];
      const newPath = gitMatch[2];
      if (oldFromHeader !== undefined && newPath !== undefined) {
        currentKey = newPath;
        current = { newLines: new Set(), oldLines: new Set() };
        if (oldFromHeader !== newPath) current.oldPath = oldFromHeader;
        files.set(currentKey, current);
        renameFrom = undefined;
      }
      continue;
    }

    const renameFromMatch = RENAME_FROM.exec(line);
    if (renameFromMatch) {
      renameFrom = renameFromMatch[1];
      if (current && renameFrom !== undefined) current.oldPath = renameFrom;
      continue;
    }

    const renameToMatch = RENAME_TO.exec(line);
    if (renameToMatch && current) {
      const toPath = renameToMatch[1];
      if (toPath !== undefined) rename(toPath);
      if (renameFrom !== undefined) current.oldPath = renameFrom;
      continue;
    }

    if (line.startsWith("--- ")) {
      const oldMatch = OLD_PATH.exec(line);
      if (oldMatch && oldMatch[1] !== undefined && current) {
        const oldPath = stripDevNull(oldMatch[1]);
        if (oldPath && currentKey && oldPath !== currentKey) current.oldPath = oldPath;
      }
      continue;
    }

    if (line.startsWith("+++ ")) {
      const newMatch = NEW_PATH.exec(line);
      if (newMatch && newMatch[1] !== undefined && current) {
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
    }
  }

  return files;
}
