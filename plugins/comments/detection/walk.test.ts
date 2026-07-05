import { describe, expect, test } from "bun:test";
import { excludeVendored, filterCodeFiles, isVendoredPath } from "./walk";

describe("filterCodeFiles", () => {
  const files = [
    "src/auth.ts",
    "src/main.py",
    "docs/readme.md",
    "Makefile",
    "queries/report.sql",
    "vendor/lib.go",
  ];

  test.each<{ name: string; globs?: string[]; expected: string[] }>([
    {
      name: "keeps only paths that map to a known language (no globs)",
      expected: ["src/auth.ts", "src/main.py", "queries/report.sql", "vendor/lib.go"],
    },
    {
      name: "intersects a single path glob with the language filter",
      globs: ["src/**"],
      expected: ["src/auth.ts", "src/main.py"],
    },
    {
      name: "keeps a path matching any of several globs",
      globs: ["src/**", "queries/**"],
      expected: ["src/auth.ts", "src/main.py", "queries/report.sql"],
    },
    {
      name: "a glob matching only non-code files yields nothing",
      globs: ["docs/**"],
      expected: [],
    },
    {
      name: "an empty glob list keeps every code file",
      globs: [],
      expected: ["src/auth.ts", "src/main.py", "queries/report.sql", "vendor/lib.go"],
    },
  ])("$name", ({ globs, expected }) => {
    expect(filterCodeFiles(files, globs)).toEqual(expected);
  });
});

describe("vendored trees", () => {
  const roots = ["plugins/x/skills/vendored"];

  test("isVendoredPath matches files under a root, not siblings or the root name", () => {
    expect(isVendoredPath("plugins/x/skills/vendored/util.py", roots)).toBe(true);
    expect(isVendoredPath("plugins/x/skills/vendored-other/util.py", roots)).toBe(false);
    expect(isVendoredPath("plugins/x/skills/own.ts", roots)).toBe(false);
  });

  test("excludeVendored drops files under any root", () => {
    const files = ["plugins/x/skills/vendored/util.py", "plugins/x/skills/own.ts"];
    expect(excludeVendored(files, roots)).toEqual(["plugins/x/skills/own.ts"]);
  });

  test("an empty root list keeps every file", () => {
    const files = ["a.ts", "b/c.py"];
    expect(excludeVendored(files, [])).toEqual(files);
  });
});
