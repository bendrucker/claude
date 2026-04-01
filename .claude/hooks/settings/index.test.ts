import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validate } from ".";

let tempDir: string;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "settings-test-"));
  await mkdir(join(tempDir, ".claude"), { recursive: true });
  await mkdir(join(tempDir, "user"), { recursive: true });
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("settings validation", () => {
  it("returns no errors for valid settings", async () => {
    await Bun.write(join(tempDir, ".claude/settings.json"), JSON.stringify({ hooks: {} }));
    const errors = await validate(tempDir);
    expect(errors.size).toBe(0);
  });

  it("returns errors for invalid top-level keys", async () => {
    await Bun.write(join(tempDir, ".claude/settings.json"), JSON.stringify({ invalidKey: true }));
    const errors = await validate(tempDir);
    expect(errors.size).toBeGreaterThan(0);
  });

  it("skips missing files", async () => {
    await rm(join(tempDir, ".claude/settings.json"), { force: true });
    await rm(join(tempDir, "user/settings.json"), { force: true });
    const errors = await validate(tempDir);
    expect(errors.size).toBe(0);
  });
});
