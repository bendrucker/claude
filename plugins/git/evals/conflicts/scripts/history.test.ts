import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { TOKEN_RANGE, build, estimateTokens, parseLines, sourceAvailable } from "./history";

const suite = resolve(import.meta.dir, "..");
const cases = readdirSync(suite, { withFileTypes: true })
  .filter(
    (entry) =>
      entry.isDirectory() && readdirSync(join(suite, entry.name)).includes("history.jsonl"),
  )
  .map((entry) => entry.name)
  .toSorted();

describe.skipIf(!sourceAvailable())("history.jsonl", () => {
  test("a case has a generated history", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  describe.each(cases)("%s", (name) => {
    const dir = join(suite, name);
    const committed = Bun.file(join(dir, "history.jsonl")).text();

    test("matches what history.ts generates", async () => {
      expect((await committed) === (await build(dir))).toBe(true);
    });

    test("is within the token range", async () => {
      const tokens = estimateTokens(await committed);
      expect(tokens).toBeGreaterThanOrEqual(TOKEN_RANGE.min);
      expect(tokens).toBeLessThanOrEqual(TOKEN_RANGE.max);
    });

    test("chains each line to its parent and ends on the assistant", async () => {
      const lines = parseLines(await committed);
      expect(lines[0]?.parentUuid).toBeNull();
      const parents = lines.slice(1).map((line) => line.parentUuid);
      expect(parents).toEqual(lines.slice(0, -1).map((line) => line.uuid));
      expect(lines.at(-1)?.type).toBe("assistant");
    });

    test("names no host", async () => {
      expect(await committed).not.toMatch(/ts\.net|tailnet|\.local\b|\.lan\b/i);
    });
  });
});
