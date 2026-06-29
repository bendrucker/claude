import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { loadPrompt, sha256 } from "./judge";

describe("sha256", () => {
  test("is stable and hex", () => {
    expect(sha256("hello")).toBe(sha256("hello"));
    expect(sha256("hello")).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256("hello")).not.toBe(sha256("world"));
  });
});

describe("loadPrompt", () => {
  test("returns text and matching sha256 for a written file", async () => {
    const path = join(import.meta.dirname, `prompt-test-${process.pid}.md`);
    const body = "# judge prompt\nScore each comment.\n";
    await Bun.write(path, body);
    try {
      const prompt = await loadPrompt(path);
      expect(prompt.text).toBe(body);
      expect(prompt.sha256).toBe(sha256(body));
    } finally {
      await Bun.file(path).delete();
    }
  });
});
