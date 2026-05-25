import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { loadWordlists } from "./wordlists";

describe("loadWordlists", () => {
  test("returns empty when directory is missing", async () => {
    const result = await loadWordlists(path.join(tmpdir(), "does-not-exist-xyz"));
    expect(result).toEqual([]);
  });

  test("loads entries, strips comments and blank lines, attaches source filename", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "wordlists-"));
    try {
      await Bun.write(
        path.join(dir, "openers.txt"),
        "# top comment\nperfect\nexcellent  # inline comment\n\nyou're right\n",
      );
      await Bun.write(path.join(dir, "verbs.txt"), "ensure\nverify\n");
      const entries = await loadWordlists(dir);
      expect(entries.map((e) => e.phrase)).toEqual([
        "perfect",
        "excellent",
        "you're right",
        "ensure",
        "verify",
      ]);
      expect(entries.filter((e) => e.source === "openers.txt")).toHaveLength(3);
      expect(entries.filter((e) => e.source === "verbs.txt")).toHaveLength(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("strips trailing weight suffixes from entries", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "wordlists-"));
    try {
      await Bun.write(path.join(dir, "verbs.txt"), "empower 2.5\nstreamline 2.5\nensure\n");
      const entries = await loadWordlists(dir);
      expect(entries.map((e) => e.phrase)).toEqual(["empower", "streamline", "ensure"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
