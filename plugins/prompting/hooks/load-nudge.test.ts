import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { MARKER_DIR, NUDGE, type NudgeEnv, nudgeOnce, parseInput } from "./load-nudge";

function memoryEnv(existing: string[]): NudgeEnv & { files: Set<string> } {
  const files = new Set(existing);
  return {
    files,
    fileExists: (path) => Promise.resolve(files.has(path)),
    touch: (path) => {
      files.add(path);
      return Promise.resolve();
    },
  };
}

describe("nudgeOnce", () => {
  test("stays silent once the skill has loaded", async () => {
    const env = memoryEnv([join(MARKER_DIR, "s1")]);
    expect(await nudgeOnce("s1", env)).toBeNull();
    expect(env.files.has(join(MARKER_DIR, "s1.nudged"))).toBe(false);
  });

  test("stays silent after the first nudge", async () => {
    const env = memoryEnv([join(MARKER_DIR, "s1.nudged")]);
    expect(await nudgeOnce("s1", env)).toBeNull();
  });

  test("nudges and records it when neither marker exists", async () => {
    const env = memoryEnv([]);
    const output = await nudgeOnce("s1", env);
    expect(output?.hookSpecificOutput).toEqual({
      hookEventName: "PreToolUse",
      additionalContext: NUDGE,
    });
    expect(env.files.has(join(MARKER_DIR, "s1.nudged"))).toBe(true);
  });
});

describe("parseInput", () => {
  test("accepts input carrying a session id", () => {
    expect(parseInput('{"session_id":"s1","tool_name":"Edit"}')?.session_id).toBe("s1");
  });

  test.each<{ name: string; text: string }>([
    { name: "non-JSON", text: "not json" },
    { name: "JSON null", text: "null" },
    { name: "empty session id", text: '{"session_id":""}' },
    { name: "numeric session id", text: '{"session_id":7}' },
    { name: "missing session id", text: "{}" },
  ])("rejects $name", ({ text }) => {
    expect(parseInput(text)).toBeNull();
  });
});
