import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { markDispatched, readDispatched, resetDispatched } from "./store";

describe("dispatched store", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "outbox-store-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  test("returns an empty set before anything is dispatched", async () => {
    expect(await readDispatched(tmpDir)).toEqual(new Set());
  });

  test("marks URLs and dedupes a repeat dispatch", async () => {
    await markDispatched("a", tmpDir);
    await markDispatched("b", tmpDir);
    await markDispatched("a", tmpDir);
    expect(await readDispatched(tmpDir)).toEqual(new Set(["a", "b"]));
  });

  test("reset clears the set", async () => {
    await markDispatched("a", tmpDir);
    await resetDispatched(tmpDir);
    expect(await readDispatched(tmpDir)).toEqual(new Set());
  });
});
