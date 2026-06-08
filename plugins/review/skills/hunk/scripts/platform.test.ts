import { describe, expect, test } from "bun:test";
import { parseDiff } from "./diff";
import type { HunkNote } from "./note";
import { toGitHubComment, toGitLabPosition, validateInDiff } from "./platform";

const SETTINGS_DIFF = `diff --git a/user/settings.json b/user/settings.json
index af2993b3..eb5273d5 100644
--- a/user/settings.json
+++ b/user/settings.json
@@ -147,7 +147,7 @@
       "source": {
         "source": "github",
         "repo": "max-sixty/worktrunk",
-        "ref": "v0.52.0"
+        "ref": "v0.55.0"
       }
     },
     "linear-cli": {`;

const DELETION_DIFF = `diff --git a/old.txt b/old.txt
index 1111111..2222222 100644
--- a/old.txt
+++ b/old.txt
@@ -10,4 +10,3 @@ context
 keep one
-removed line
 keep two
 keep three`;

function note(overrides: Partial<HunkNote>): HunkNote {
  return {
    noteId: "user:1",
    source: "user",
    filePath: "user/settings.json",
    hunkIndex: 0,
    newRange: null,
    oldRange: null,
    body: "comment",
    ...overrides,
  };
}

describe("validateInDiff", () => {
  test("accepts a note on a changed new-side line", () => {
    const parsed = parseDiff(SETTINGS_DIFF);
    expect(validateInDiff(note({ newRange: [150, 150] }), parsed)).toEqual({ ok: true });
  });

  test("rejects an off-diff anchor", () => {
    const parsed = parseDiff(SETTINGS_DIFF);
    const result = validateInDiff(note({ newRange: [1, 1] }), parsed);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("line 1");
  });

  test("accepts an old-side deletion anchor", () => {
    const parsed = parseDiff(DELETION_DIFF);
    expect(validateInDiff(note({ filePath: "old.txt", oldRange: [11, 11] }), parsed)).toEqual({
      ok: true,
    });
  });

  test("rejects a file not present in the diff", () => {
    const parsed = parseDiff(SETTINGS_DIFF);
    const result = validateInDiff(note({ filePath: "missing.ts", newRange: [5, 5] }), parsed);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("not in the diff");
  });

  test("rejects an anchor one line past a newline-terminated hunk", () => {
    const parsed = parseDiff(`${SETTINGS_DIFF}\n`);
    const result = validateInDiff(note({ newRange: [154, 154] }), parsed);
    expect(result.ok).toBe(false);
  });

  test("accepts an added line whose text starts with +++", () => {
    const diff = `diff --git a/a.txt b/a.txt
index 1111111..2222222 100644
--- a/a.txt
+++ b/a.txt
@@ -1,2 +1,3 @@
 context
+++ still added
 trailing
`;
    const parsed = parseDiff(diff);
    expect(validateInDiff(note({ filePath: "a.txt", newRange: [2, 2] }), parsed)).toEqual({
      ok: true,
    });
  });

  test("accepts a deleted line whose text starts with ---", () => {
    const diff = `diff --git a/b.txt b/b.txt
index 1111111..2222222 100644
--- a/b.txt
+++ b/b.txt
@@ -1,3 +1,2 @@
 context
--- still removed
 trailing
`;
    const parsed = parseDiff(diff);
    expect(validateInDiff(note({ filePath: "b.txt", oldRange: [2, 2] }), parsed)).toEqual({
      ok: true,
    });
  });
});

describe("toGitHubComment", () => {
  test("maps a new-side note to RIGHT", () => {
    expect(toGitHubComment(note({ newRange: [150, 150] }), { commitId: "abc123" })).toEqual({
      path: "user/settings.json",
      line: 150,
      side: "RIGHT",
      commit_id: "abc123",
      body: "comment",
    });
  });

  test("maps an old-side deletion to LEFT", () => {
    expect(
      toGitHubComment(note({ filePath: "old.txt", oldRange: [11, 11] }), { commitId: "abc123" }),
    ).toEqual({
      path: "old.txt",
      line: 11,
      side: "LEFT",
      commit_id: "abc123",
      body: "comment",
    });
  });
});

describe("toGitLabPosition", () => {
  const refs = { base_sha: "base", head_sha: "head", start_sha: "start" };

  test("sets new_line for a new-side note and defaults old_path to new_path", () => {
    expect(
      toGitLabPosition(note({ newRange: [150, 150] }), refs, { newPath: "user/settings.json" }),
    ).toEqual({
      position_type: "text",
      base_sha: "base",
      head_sha: "head",
      start_sha: "start",
      new_path: "user/settings.json",
      old_path: "user/settings.json",
      new_line: 150,
    });
  });

  test("sets old_line for an old-side deletion", () => {
    expect(
      toGitLabPosition(note({ filePath: "old.txt", oldRange: [11, 11] }), refs, {
        newPath: "old.txt",
      }),
    ).toEqual({
      position_type: "text",
      base_sha: "base",
      head_sha: "head",
      start_sha: "start",
      new_path: "old.txt",
      old_path: "old.txt",
      old_line: 11,
    });
  });

  test("carries distinct old_path for a rename", () => {
    expect(
      toGitLabPosition(note({ filePath: "src/new-name.ts", newRange: [7, 7] }), refs, {
        newPath: "src/new-name.ts",
        oldPath: "src/old-name.ts",
      }),
    ).toEqual({
      position_type: "text",
      base_sha: "base",
      head_sha: "head",
      start_sha: "start",
      new_path: "src/new-name.ts",
      old_path: "src/old-name.ts",
      new_line: 7,
    });
  });
});
