import { afterAll, afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runValidation } from "./run";

let tempDir: string;
let schemaPath: string;

const schema = {
  type: "object",
  properties: {
    name: { type: "string" },
  },
  required: ["name"],
};

async function writeFixture(name: string, data: unknown): Promise<string> {
  const file = join(tempDir, `${name}.json`);
  await Bun.write(file, JSON.stringify(data));
  return file;
}

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "run-test-"));
  await mkdir(join(tempDir, "schemas"), { recursive: true });
  schemaPath = join(tempDir, "schemas/run.json");
  await Bun.write(schemaPath, JSON.stringify(schema));
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

const logSpy = spyOn(console, "log").mockImplementation(() => {});

afterEach(() => {
  logSpy.mockClear();
});

describe("runValidation", () => {
  it("logs each file, a blank line, and the success message", async () => {
    const a = await writeFixture("valid-a", { name: "a" });
    const b = await writeFixture("valid-b", { name: "b" });

    await runValidation({ files: [a, b], schema: schemaPath });

    const lines = logSpy.mock.calls.map((call) => call[0]);
    expect(lines).toEqual([`• ${a}`, `• ${b}`, "", "Validation passed."]);
  });

  it("honors a custom success message", async () => {
    const file = await writeFixture("valid-custom", { name: "ok" });

    await runValidation({ files: [file], schema: schemaPath, successMessage: "All good." });

    const lines = logSpy.mock.calls.map((call) => call[0]);
    expect(lines.at(-1)).toBe("All good.");
  });

  it("emits warnings when warnAdditional is set", async () => {
    const file = await writeFixture("warn-extra", { name: "ok", extra: true });

    await runValidation({ files: [file], schema: schemaPath, warnAdditional: true });

    const lines = logSpy.mock.calls.map((call) => call[0]);
    expect(lines.some((line) => typeof line === "string" && line.includes("extra"))).toBe(true);
  });

  it("exits non-zero on validation errors", async () => {
    const file = await writeFixture("invalid", { name: 123 });
    const exitSpy = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);

    try {
      await expect(runValidation({ files: [file], schema: schemaPath })).rejects.toThrow("exit");
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      exitSpy.mockRestore();
    }
  });
});
