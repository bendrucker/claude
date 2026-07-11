import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { extractCommands, hasBypassMarker, processInput } from "./sandbox";

let fixtureDir: string;
let markedScriptPath: string;
let unmarkedScriptPath: string;

beforeAll(async () => {
  fixtureDir = await mkdtemp(`${tmpdir()}${sep}sandbox-test-`);

  markedScriptPath = join(fixtureDir, "marked.ts");
  await Bun.write(
    markedScriptPath,
    `#!/usr/bin/env bun\n// claude:dangerouslyDisableSandbox: hands off to Apple Events\nconsole.log("hi");\n`,
  );

  unmarkedScriptPath = join(fixtureDir, "unmarked.ts");
  await Bun.write(unmarkedScriptPath, `#!/usr/bin/env bun\nconsole.log("hi");\n`);
});

afterAll(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(fixtureDir, { recursive: true, force: true });
});

function makeInput(command: string, toolName = "Bash"): PreToolUseHookInput {
  return {
    tool_name: toolName,
    tool_input: { command },
  } as PreToolUseHookInput;
}

describe("extractCommands", () => {
  test("captures bun script arg", () => {
    expect(extractCommands("bun watch.ts --pr 42")).toEqual([
      { cmd: "bun", scriptArg: "watch.ts" },
    ]);
  });

  test("captures node script arg", () => {
    expect(extractCommands("node ./scripts/run.js")).toEqual([
      { cmd: "node", scriptArg: "./scripts/run.js" },
    ]);
  });

  test("captures env-prefixed bun script arg", () => {
    expect(extractCommands("FOO=bar bun watch.ts")).toEqual([
      { cmd: "bun", scriptArg: "watch.ts" },
    ]);
  });

  test("captures bun script arg through a pipe", () => {
    expect(extractCommands("bun watch.ts | jq .rate")).toEqual([
      { cmd: "bun", scriptArg: "watch.ts" },
      { cmd: "jq" },
    ]);
  });

  test("skips bun flag-bearing invocation", () => {
    expect(extractCommands("bun --silent watch.ts")).toEqual([{ cmd: "bun" }]);
  });

  test("absolute bun script path", () => {
    expect(extractCommands("bun /abs/path/watch.ts")).toEqual([
      { cmd: "bun", scriptArg: "/abs/path/watch.ts" },
    ]);
  });
});

describe("hasBypassMarker", () => {
  test("detects bypass marker in script", async () => {
    expect(await hasBypassMarker(markedScriptPath)).toBe(true);
  });

  test("returns false for script without marker", async () => {
    expect(await hasBypassMarker(unmarkedScriptPath)).toBe(false);
  });

  test("returns false for nonexistent path", async () => {
    expect(await hasBypassMarker("/nonexistent/path")).toBe(false);
  });
});

describe("processInput", () => {
  test("returns null on non-darwin", async () => {
    const result = await processInput(makeInput(`bun ${markedScriptPath}`), "linux");
    expect(result).toBeNull();
  });

  test("returns null when command is undefined", async () => {
    const input = { tool_name: "Bash", tool_input: {} } as PreToolUseHookInput;
    const result = await processInput(input, "darwin");
    expect(result).toBeNull();
  });

  test("disables sandbox for marked bun script", async () => {
    const input = makeInput(`bun ${markedScriptPath} --pr 42`);
    const result = await processInput(input, "darwin");
    expect(result).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        updatedInput: {
          ...(input.tool_input as Record<string, unknown>),
          dangerouslyDisableSandbox: true,
        },
      },
    });
  });

  test("does not disable sandbox for unmarked bun script", async () => {
    const result = await processInput(makeInput(`bun ${unmarkedScriptPath}`), "darwin");
    expect(result).toBeNull();
  });

  test("processes Monitor tool input the same as Bash", async () => {
    const input = makeInput(`bun ${markedScriptPath}`, "Monitor");
    const result = await processInput(input, "darwin");
    expect(result?.hookSpecificOutput).toMatchObject({
      hookEventName: "PreToolUse",
      updatedInput: { dangerouslyDisableSandbox: true },
    });
  });
});
