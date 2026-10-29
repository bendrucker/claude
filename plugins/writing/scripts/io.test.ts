import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readInput } from "./io";

describe("readInput", () => {
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "writing-input-"));
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
