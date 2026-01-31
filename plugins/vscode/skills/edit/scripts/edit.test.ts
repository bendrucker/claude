import { afterEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { dirname, extname } from "node:path";
import { createTempFile, readAndCleanup } from "./edit";

const tempPaths: string[] = [];

afterEach(async () => {
  for (const p of tempPaths) {
    const dir = dirname(p);
    if (existsSync(dir)) {
      await rm(dir, { recursive: true });
    }
  }
  tempPaths.length = 0;
});

describe("createTempFile", () => {
  it("creates a temp file with the given content and extension", async () => {
    const filePath = await createTempFile("hello world", "json");
    tempPaths.push(filePath);

    expect(await readFile(filePath, "utf-8")).toBe("hello world");
    expect(extname(filePath)).toBe(".json");
    expect(dirname(filePath)).toMatch(/^\/tmp\/claude\/vscode-edit-/);
  });

  it("creates a unique directory for each call", async () => {
    const path1 = await createTempFile("a", "md");
    const path2 = await createTempFile("b", "md");
    tempPaths.push(path1, path2);

    expect(dirname(path1)).not.toBe(dirname(path2));
  });
});

describe("readAndCleanup", () => {
  it("returns the file content", async () => {
    const filePath = await createTempFile("read me", "txt");
    const content = await readAndCleanup(filePath);
    expect(content).toBe("read me");
  });

  it("removes the parent directory after reading", async () => {
    const filePath = await createTempFile("temporary", "txt");
    const dir = dirname(filePath);
    await readAndCleanup(filePath);
    expect(existsSync(dir)).toBe(false);
  });
});
