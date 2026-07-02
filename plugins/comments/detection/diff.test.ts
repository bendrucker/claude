import { describe, expect, test } from "bun:test";
import { parseUnifiedDiff, resolveDiff } from "./diff";

describe("parseUnifiedDiff", () => {
  test("single file, single hunk, coalesces added lines into ranges", () => {
    const diff = `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,6 @@
 const a = 1;
+const b = 2;
+const c = 3;
+const d = 4;
 const e = 5;
 const f = 6;
`;
    expect(parseUnifiedDiff(diff)).toEqual([{ path: "src/app.ts", added: [{ start: 2, end: 4 }] }]);
  });

  test("non-consecutive added lines split into separate ranges", () => {
    const diff = `--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,5 @@
 line one
+added two
 line three
+added four
 line five
`;
    expect(parseUnifiedDiff(diff)).toEqual([
      {
        path: "file.ts",
        added: [
          { start: 2, end: 2 },
          { start: 4, end: 4 },
        ],
      },
    ]);
  });

  test("deletions do not advance the new-file counter", () => {
    const diff = `--- a/file.ts
+++ b/file.ts
@@ -1,6 +1,5 @@
 keep one
-removed two
-removed three
+added two
 keep three
 keep four
 keep five
`;
    expect(parseUnifiedDiff(diff)).toEqual([{ path: "file.ts", added: [{ start: 2, end: 2 }] }]);
  });

  test("counter starts at the hunk header's new-file start", () => {
    const diff = `--- a/file.ts
+++ b/file.ts
@@ -10,3 +10,4 @@
 context ten
+added eleven
 context twelve
 context thirteen
`;
    expect(parseUnifiedDiff(diff)).toEqual([{ path: "file.ts", added: [{ start: 11, end: 11 }] }]);
  });

  test("multiple hunks in one file", () => {
    const diff = `--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,4 @@
 a
+added two
 b
 c
@@ -20,3 +21,5 @@
 t
+added twentytwo
+added twentythree
 u
 v
`;
    expect(parseUnifiedDiff(diff)).toEqual([
      {
        path: "file.ts",
        added: [
          { start: 2, end: 2 },
          { start: 22, end: 23 },
        ],
      },
    ]);
  });

  test("multiple files in one diff", () => {
    const diff = `diff --git a/one.ts b/one.ts
--- a/one.ts
+++ b/one.ts
@@ -1,2 +1,3 @@
 a
+added two
 b
diff --git a/two.ts b/two.ts
--- a/two.ts
+++ b/two.ts
@@ -1,2 +1,3 @@
 x
+added two
 y
`;
    expect(parseUnifiedDiff(diff)).toEqual([
      { path: "one.ts", added: [{ start: 2, end: 2 }] },
      { path: "two.ts", added: [{ start: 2, end: 2 }] },
    ]);
  });

  test("pure deletion hunk yields no added ranges", () => {
    const diff = `--- a/file.ts
+++ b/file.ts
@@ -1,4 +1,2 @@
 keep one
-removed two
-removed three
 keep four
`;
    expect(parseUnifiedDiff(diff)).toEqual([{ path: "file.ts", added: [] }]);
  });

  test("skips files deleted entirely (+++ /dev/null)", () => {
    const diff = `diff --git a/gone.ts b/gone.ts
deleted file mode 100644
--- a/gone.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-line one
-line two
diff --git a/kept.ts b/kept.ts
--- a/kept.ts
+++ b/kept.ts
@@ -1,1 +1,2 @@
 a
+added two
`;
    expect(parseUnifiedDiff(diff)).toEqual([{ path: "kept.ts", added: [{ start: 2, end: 2 }] }]);
  });

  test("strips the b/ prefix and preserves subdirectory paths", () => {
    const diff = `--- a/src/nested/deep/mod.ts
+++ b/src/nested/deep/mod.ts
@@ -1,1 +1,2 @@
 a
+added two
`;
    expect(parseUnifiedDiff(diff)).toEqual([
      { path: "src/nested/deep/mod.ts", added: [{ start: 2, end: 2 }] },
    ]);
  });

  test("hunk header without explicit counts defaults to length 1", () => {
    const diff = `--- a/file.ts
+++ b/file.ts
@@ -1 +1,2 @@
 a
+added two
`;
    expect(parseUnifiedDiff(diff)).toEqual([{ path: "file.ts", added: [{ start: 2, end: 2 }] }]);
  });

  test("a newly added file (all + lines) coalesces into one range", () => {
    const diff = `diff --git a/new.ts b/new.ts
new file mode 100644
--- /dev/null
+++ b/new.ts
@@ -0,0 +1,3 @@
+line one
+line two
+line three
`;
    expect(parseUnifiedDiff(diff)).toEqual([{ path: "new.ts", added: [{ start: 1, end: 3 }] }]);
  });

  test("empty diff yields no files", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
  });
});

test("resolveDiff is a function", () => {
  expect(typeof resolveDiff).toBe("function");
});
