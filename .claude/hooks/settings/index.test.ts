import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validate } from ".";

let tempDir: string;

// A minimal stand-in for the remote settings schema. Injecting it keeps the
// tests deterministic and offline; fetching the live schema is exercised
// end-to-end by the hook itself, not here.
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { hooks: { type: "object" } },
};

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
    const errors = await validate(tempDir, SCHEMA);
    expect(errors.size).toBe(0);
  });

  it("returns errors for invalid top-level keys", async () => {
    await Bun.write(join(tempDir, ".claude/settings.json"), JSON.stringify({ invalidKey: true }));
    const errors = await validate(tempDir, SCHEMA);
    expect(errors.size).toBeGreaterThan(0);
  });

  it("allows allowAppleEvents on sandbox even when the schema omits it", async () => {
    const sandboxSchema = {
      type: "object",
      additionalProperties: false,
      properties: {
        sandbox: {
          type: "object",
          additionalProperties: false,
          properties: { enabled: { type: "boolean" } },
        },
      },
    };
    await Bun.write(
      join(tempDir, ".claude/settings.json"),
      JSON.stringify({ sandbox: { enabled: true, allowAppleEvents: true } }),
    );
    const errors = await validate(tempDir, sandboxSchema);
    expect(errors.size).toBe(0);
  });

  it("skips missing files", async () => {
    await rm(join(tempDir, ".claude/settings.json"), { force: true });
    await rm(join(tempDir, "user/settings.json"), { force: true });
    const errors = await validate(tempDir, SCHEMA);
    expect(errors.size).toBe(0);
  });
});
