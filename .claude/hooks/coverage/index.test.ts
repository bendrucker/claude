import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { computeHint, formatHint, isStale, processPostToolUse } from "./index";

const repoRoot = join(import.meta.dirname, "..", "..", "..");
const workDir = join(repoRoot, "tmp", "cov-hook-test");
const sourceFile = join(workDir, "sample.ts");
const lcovPath = join(workDir, "lcov.info");

function lcovFor(uncovered: number[]): string {
  const rel = relative(repoRoot, sourceFile);
  const da = [1, 2, 3, 4].map((n) => `DA:${n},${uncovered.includes(n) ? 0 : 1}`).join("\n");
  return `TN:\nSF:${rel}\nFNF:1\nFNH:1\n${da}\nend_of_record\n`;
}

beforeEach(async () => {
  mkdirSync(workDir, { recursive: true });
  await Bun.write(sourceFile, "export const a = 1;\n");
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("isStale", () => {
  test.each([
    [2000, 1000, true],
    [1000, 2000, false],
    [1000, 1000, false],
  ])("isStale(%i, %i) -> %p", (file, lcov, expected) => {
    expect(isStale(file, lcov)).toBe(expected);
  });
});

describe("computeHint", () => {
  test("returns null when no coverage data exists", async () => {
    expect(await computeHint(sourceFile, lcovPath)).toBeNull();
  });

  test("returns null when the file is fully covered", async () => {
    await Bun.write(lcovPath, lcovFor([]));
    expect(await computeHint(sourceFile, lcovPath)).toBeNull();
  });

  test("returns null when the file was never measured", async () => {
    await Bun.write(lcovPath, "TN:\nSF:other/file.ts\nDA:1,0\nend_of_record\n");
    expect(await computeHint(sourceFile, lcovPath)).toBeNull();
  });

  test("surfaces uncovered lines when coverage is current", async () => {
    // lcov written after the source, so it is at least as new -> not stale.
    await Bun.write(lcovPath, lcovFor([2, 3]));
    const hint = await computeHint(sourceFile, lcovPath);
    expect(hint?.uncovered).toEqual([2, 3]);
    expect(hint?.stale).toBe(false);
  });
});

describe("formatHint", () => {
  test("lists lines and points to the coverage skill", () => {
    const message = formatHint({ file: "a.ts", uncovered: [2, 3], stale: false });
    expect(message).toContain("a.ts has uncovered lines: 2, 3");
    expect(message).toContain("coverage` skill");
    expect(message).not.toContain("predates");
  });

  test("includes a refresh hint when stale", () => {
    const message = formatHint({ file: "a.ts", uncovered: [2], stale: true });
    expect(message).toContain("predates your edit");
  });
});

describe("processPostToolUse", () => {
  test("ignores non-edit tools", async () => {
    const result = await processPostToolUse({
      hook_event_name: "PostToolUse",
      tool_name: "Read",
      tool_input: { file_path: sourceFile },
    } as Parameters<typeof processPostToolUse>[0]);
    expect(result).toBeNull();
  });

  test("ignores test files", async () => {
    const result = await processPostToolUse({
      hook_event_name: "PostToolUse",
      tool_name: "Edit",
      tool_input: { file_path: join(workDir, "sample.test.ts") },
    } as Parameters<typeof processPostToolUse>[0]);
    expect(result).toBeNull();
  });
});
