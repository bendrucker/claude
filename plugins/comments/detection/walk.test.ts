import { describe, expect, test } from "bun:test";
import { filterCodeFiles } from "./walk";

describe("filterCodeFiles", () => {
  const files = [
    "src/auth.ts",
    "src/main.py",
    "docs/readme.md",
    "Makefile",
    "queries/report.sql",
    "vendor/lib.go",
  ];

  test("keeps only paths that map to a known language", () => {
    expect(filterCodeFiles(files)).toEqual([
      "src/auth.ts",
      "src/main.py",
      "queries/report.sql",
      "vendor/lib.go",
    ]);
  });

  test("intersects a single path glob with the language filter", () => {
    expect(filterCodeFiles(files, ["src/**"])).toEqual(["src/auth.ts", "src/main.py"]);
  });

  test("keeps a path matching any of several globs", () => {
    expect(filterCodeFiles(files, ["src/**", "queries/**"])).toEqual([
      "src/auth.ts",
      "src/main.py",
      "queries/report.sql",
    ]);
  });

  test("a glob matching only non-code files yields nothing", () => {
    expect(filterCodeFiles(files, ["docs/**"])).toEqual([]);
  });

  test("an empty glob list keeps every code file", () => {
    expect(filterCodeFiles(files, [])).toEqual(filterCodeFiles(files));
  });
});
