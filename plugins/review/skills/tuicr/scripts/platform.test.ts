import { describe, expect, test } from "bun:test";
import type { TuicrComment } from "./comment";
import { parseDiff } from "./diff";
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

function comment(overrides: Partial<TuicrComment>): TuicrComment {
  return {
    id: "c1",
    location: "user/settings.json:150",
    path: "user/settings.json",
    start_line: null,
    end_line: null,
    side: "new",
    comment_type: "issue",
    lifecycle_state: "local_draft",
    content: "comment",
    ...overrides,
  };
}

describe("validateInDiff", () => {
  test("accepts a comment on a changed new-side line", () => {
    const parsed = parseDiff(SETTINGS_DIFF);
    expect(
      validateInDiff(comment({ start_line: 150, end_line: 150, side: "new" }), parsed),
    ).toEqual({ ok: true });
  });

  test("rejects an off-diff anchor", () => {
    const parsed = parseDiff(SETTINGS_DIFF);
    const result = validateInDiff(comment({ start_line: 1, end_line: 1, side: "new" }), parsed);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("line 1");
  });

  test("accepts an old-side deletion anchor", () => {
    const parsed = parseDiff(DELETION_DIFF);
    expect(
      validateInDiff(
        comment({ path: "old.txt", start_line: 11, end_line: 11, side: "old" }),
        parsed,
      ),
    ).toEqual({ ok: true });
  });

  test("rejects a file not present in the diff", () => {
    const parsed = parseDiff(SETTINGS_DIFF);
    const result = validateInDiff(
      comment({ path: "missing.ts", start_line: 5, end_line: 5, side: "new" }),
      parsed,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("not in the diff");
  });

  test("rejects an anchor one line past a newline-terminated hunk", () => {
    const parsed = parseDiff(`${SETTINGS_DIFF}\n`);
    const result = validateInDiff(comment({ start_line: 154, end_line: 154, side: "new" }), parsed);
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
    expect(
      validateInDiff(comment({ path: "a.txt", start_line: 2, end_line: 2, side: "new" }), parsed),
    ).toEqual({ ok: true });
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
    expect(
      validateInDiff(comment({ path: "b.txt", start_line: 2, end_line: 2, side: "old" }), parsed),
    ).toEqual({ ok: true });
  });
});

describe("toGitHubComment", () => {
  test("maps a new-side comment to RIGHT", () => {
    expect(
      toGitHubComment(comment({ start_line: 150, end_line: 150, side: "new" }), {
        commitId: "abc123",
      }),
    ).toEqual({
      path: "user/settings.json",
      line: 150,
      side: "RIGHT",
      commit_id: "abc123",
      body: "comment",
    });
  });

  test("maps an old-side deletion to LEFT", () => {
    expect(
      toGitHubComment(comment({ path: "old.txt", start_line: 11, end_line: 11, side: "old" }), {
        commitId: "abc123",
      }),
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

  test("sets new_line for a new-side comment and defaults old_path to new_path", () => {
    expect(
      toGitLabPosition(comment({ start_line: 150, end_line: 150, side: "new" }), refs, {
        newPath: "user/settings.json",
      }),
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
      toGitLabPosition(
        comment({ path: "old.txt", start_line: 11, end_line: 11, side: "old" }),
        refs,
        {
          newPath: "old.txt",
        },
      ),
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
      toGitLabPosition(
        comment({ path: "src/new-name.ts", start_line: 7, end_line: 7, side: "new" }),
        refs,
        {
          newPath: "src/new-name.ts",
          oldPath: "src/old-name.ts",
        },
      ),
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
