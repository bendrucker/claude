import { describe, expect, test } from "bun:test";
import { parseDiff } from "./diff";

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

const RENAME_DIFF = `diff --git a/src/old-name.ts b/src/new-name.ts
similarity index 90%
rename from src/old-name.ts
rename to src/new-name.ts
index 3333333..4444444 100644
--- a/src/old-name.ts
+++ b/src/new-name.ts
@@ -5,3 +5,3 @@ export function foo() {
   const a = 1;
-  return a;
+  return a + 1;
 }`;

describe("parseDiff", () => {
  test("collects new-side and old-side line sets for a modification", () => {
    const parsed = parseDiff(SETTINGS_DIFF);
    const file = parsed.get("user/settings.json");
    expect(file).toBeDefined();
    expect(file?.newLines.has(150)).toBe(true);
    expect(file?.oldLines.has(150)).toBe(true);
    expect(file?.newLines.has(147)).toBe(true);
    expect(file?.newLines.has(1)).toBe(false);
    expect(file?.oldPath).toBeUndefined();
  });

  test("records old-side line for a deletion", () => {
    const parsed = parseDiff(DELETION_DIFF);
    const file = parsed.get("old.txt");
    expect(file?.oldLines.has(11)).toBe(true);
    expect(file?.oldLines.has(13)).toBe(true);
    expect(file?.newLines.has(13)).toBe(false);
  });

  test("tracks rename old/new paths", () => {
    const parsed = parseDiff(RENAME_DIFF);
    expect(parsed.has("src/new-name.ts")).toBe(true);
    expect(parsed.has("src/old-name.ts")).toBe(false);
    expect(parsed.get("src/new-name.ts")?.oldPath).toBe("src/old-name.ts");
  });

  test("classifies an added line that looks like a +++ header as new-side content", () => {
    const diff = `diff --git a/a.txt b/a.txt
index 1111111..2222222 100644
--- a/a.txt
+++ b/a.txt
@@ -1,2 +1,3 @@
 context
+++ still added
 trailing
`;
    const file = parseDiff(diff).get("a.txt");
    // context=1, "+++ still added"=new 2, trailing=new 3 / old 2.
    expect(file?.newLines.has(1)).toBe(true);
    expect(file?.newLines.has(2)).toBe(true);
    expect(file?.newLines.has(3)).toBe(true);
    expect(file?.oldLines.has(2)).toBe(true);
    expect(file?.oldLines.has(3)).toBe(false);
  });

  test("classifies a deleted line that looks like a --- header as old-side content", () => {
    const diff = `diff --git a/b.txt b/b.txt
index 1111111..2222222 100644
--- a/b.txt
+++ b/b.txt
@@ -1,3 +1,2 @@
 context
--- still removed
 trailing
`;
    const file = parseDiff(diff).get("b.txt");
    // context=old 1, "--- still removed"=old 2, trailing=old 3 / new 2.
    expect(file?.oldLines.has(1)).toBe(true);
    expect(file?.oldLines.has(2)).toBe(true);
    expect(file?.oldLines.has(3)).toBe(true);
    expect(file?.newLines.has(2)).toBe(true);
    expect(file?.newLines.has(3)).toBe(false);
  });

  test("a newline-terminated diff does not create a phantom line past the hunk", () => {
    const parsed = parseDiff(`${SETTINGS_DIFF}\n`);
    const file = parsed.get("user/settings.json");
    // Last new-side line in the hunk is 153 (147..153). 154 is past the hunk.
    expect(file?.newLines.has(153)).toBe(true);
    expect(file?.newLines.has(154)).toBe(false);
  });
});
