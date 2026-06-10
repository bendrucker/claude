import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readInput } from "../../../scripts/io";
import { collectFiles, scanFiles, shouldSkip, toGlob } from "./scan";

describe("shouldSkip", () => {
  it("skips node_modules", () => {
    expect(shouldSkip("plugins/writing/node_modules/foo/readme.md")).toBe(true);
  });

  it("skips .git", () => {
    expect(shouldSkip("repo/.git/COMMIT_EDITMSG")).toBe(true);
  });

  it("skips wordlist files", () => {
    expect(shouldSkip("plugins/writing/wordlists/vocabulary.txt")).toBe(true);
  });

  it("skips top-level-relative wordlist files", () => {
    expect(shouldSkip("wordlists/vocabulary.txt")).toBe(true);
  });

  it("skips absolute wordlist files", () => {
    expect(shouldSkip("/repo/wordlists/vocabulary.txt")).toBe(true);
  });

  it("does not skip a non-wordlists directory ending in wordlists", () => {
    expect(shouldSkip("docs/mywordlists/vocabulary.txt")).toBe(false);
  });

  it("skips memory and plan paths", () => {
    expect(shouldSkip("/home/u/.claude/projects/proj/memory/MEMORY.md")).toBe(true);
    expect(shouldSkip(`${process.env.HOME}/.claude/plans/feature.md`)).toBe(true);
  });

  it("keeps ordinary prose", () => {
    expect(shouldSkip("docs/guide.md")).toBe(false);
  });
});

describe("toGlob", () => {
  it("treats a missing path as a glob from cwd", () => {
    expect(toGlob("docs/**/*.md")).toEqual({ cwd: ".", pattern: "docs/**/*.md" });
  });
});

describe("collectFiles and scanFiles", () => {
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "writing-scan-"));
    await Bun.write(join(dir, "dirty.md"), "We delve into a robust tapestry of ideas.\n");
    await Bun.write(join(dir, "clean.md"), "The function reads input and writes output.\n");
    await Bun.write(join(dir, "code.ts"), "const serves = 1; // serves as nothing\n");
    mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true });
    await Bun.write(join(dir, "node_modules", "pkg", "readme.md"), "We delve into the tapestry.\n");
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("collects prose files and skips non-prose and node_modules", async () => {
    const files = await collectFiles(dir);
    expect(files.some((f) => f.endsWith("dirty.md"))).toBe(true);
    expect(files.some((f) => f.endsWith("clean.md"))).toBe(true);
    expect(files.some((f) => f.endsWith("code.ts"))).toBe(false);
    expect(files.some((f) => f.includes("node_modules"))).toBe(false);
  });

  it("reports violations only for files that have them", async () => {
    const files = await collectFiles(dir);
    const results = await scanFiles(files);
    const paths = results.map((r) => r.path);
    expect(paths.some((p) => p.endsWith("dirty.md"))).toBe(true);
    expect(paths.some((p) => p.endsWith("clean.md"))).toBe(false);
  });

  it("attaches positioned violations to each file", async () => {
    const results = await scanFiles(await collectFiles(dir));
    const dirty = results.find((r) => r.path.endsWith("dirty.md"));
    expect(dirty).toBeDefined();
    const categories = dirty?.violations.map((v) => v.category) ?? [];
    expect(categories).toContain("AI vocabulary");
    for (const v of dirty?.violations ?? []) {
      expect(v.line).toBeGreaterThanOrEqual(1);
      expect(v.col).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("readInput", () => {
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "writing-scan-input-"));
    await Bun.write(join(dir, "doc.md"), "The function reads input.\n");
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads an existing file and reports its path", async () => {
    const path = join(dir, "doc.md");
    expect(await readInput(path)).toEqual({ text: "The function reads input.\n", filePath: path });
  });

  it("treats a non-existent argument as inline text", async () => {
    expect(await readInput("The function reads input.")).toEqual({
      text: "The function reads input.",
    });
  });
});
