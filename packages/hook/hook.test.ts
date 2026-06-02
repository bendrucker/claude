import { describe, expect, mock, test } from "bun:test";

let stdinValue: unknown = {};
let stdinError: Error | null = null;
const writes: unknown[] = [];

mock.module("@constellos/claude-code-kit/runners", () => ({
  readStdinJson: async () => {
    if (stdinError) throw stdinError;
    return stdinValue;
  },
  writeStdoutJson: (output: unknown) => {
    writes.push(output);
  },
}));

const { runHook } = await import("./index");

describe("runHook", () => {
  test("writes JSON when the handler returns an object", async () => {
    writes.length = 0;
    stdinError = null;
    stdinValue = { tool_name: "Bash" };

    const output = { decision: "allow" };
    await runHook(() => output, "test/object");

    expect(writes).toEqual([output]);
  });

  test("writes nothing when the handler returns null", async () => {
    writes.length = 0;
    stdinError = null;
    stdinValue = {};

    await runHook(() => null, "test/null");

    expect(writes).toEqual([]);
  });

  test("awaits async handlers", async () => {
    writes.length = 0;
    stdinError = null;
    stdinValue = {};

    const output = { ok: true };
    await runHook(async () => output, "test/async");

    expect(writes).toEqual([output]);
  });

  test("logs and writes nothing on parse error", async () => {
    writes.length = 0;
    stdinError = new Error("bad json");
    const errors: string[] = [];
    const original = console.error;
    console.error = (message: string) => {
      errors.push(message);
    };

    try {
      await runHook(() => ({ ok: true }), "test/parse-error");
    } finally {
      console.error = original;
    }

    expect(writes).toEqual([]);
    expect(errors[0]).toBe("[test/parse-error] Failed to parse hook input: bad json");
  });
});
