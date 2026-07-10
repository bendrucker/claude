import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendSample, type HistorySample, readHistory } from "../scripts/history";

const DAY = 24 * 60 * 60 * 1000;

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rate-limits-history-"));
  path = join(dir, "history.ndjson");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function sample(t: number, five: number, fiveReset = 1000): HistorySample {
  return { t, five, fiveReset, seven: null, sevenReset: null };
}

describe("edge-triggered append", () => {
  test("appending an unchanged percentage adds no line", async () => {
    const now = 10 * DAY;
    await appendSample(sample(now, 40), path);
    await appendSample(sample(now + 60000, 40), path);
    expect((await readHistory(path)).length).toBe(1);
  });

  test("a changed percentage appends a line", async () => {
    const now = 10 * DAY;
    await appendSample(sample(now, 40), path);
    await appendSample(sample(now + 60000, 41), path);
    expect((await readHistory(path)).length).toBe(2);
  });

  test("the same percentage in a new block appends a line", async () => {
    const now = 10 * DAY;
    await appendSample(sample(now, 40, 1000), path);
    await appendSample(sample(now + 60000, 40, 2000), path);
    expect((await readHistory(path)).length).toBe(2);
  });
});

describe("7-day prune", () => {
  test("appending across the 7-day boundary drops stale lines", async () => {
    const now = 10 * DAY;
    await appendSample(sample(now - 8 * DAY, 10), path);
    await appendSample(sample(now, 40), path);

    const history = await readHistory(path);
    expect(history.length).toBe(1);
    expect(history[0].five).toBe(40);
  });
});

describe("read-side dedup", () => {
  test("consecutive identical observations collapse", async () => {
    const now = 10 * DAY;
    const dup = `${JSON.stringify(sample(now, 40))}\n${JSON.stringify(sample(now + 1, 40))}\n`;
    await Bun.write(path, dup);
    expect((await readHistory(path)).length).toBe(1);
  });
});
