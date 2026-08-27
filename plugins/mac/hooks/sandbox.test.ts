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

function makeInput(toolInput: unknown, toolName = "Bash"): PreToolUseHookInput {
  return {
    hook_event_name: "PreToolUse",
    session_id: "s",
    transcript_path: "/dev/null",
    cwd: "/",
    tool_name: toolName,
    tool_input: toolInput,
    tool_use_id: "t",
  };
}

const bashInput = (command: string) => makeInput({ command });

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

  test.each<[string, string]>([
    ["/abs/path/refresh.ts --refresh", "/abs/path/refresh.ts"],
    ["./scripts/run.sh foo", "./scripts/run.sh"],
  ])("directly executed script %p is its own script arg", (command, expected) => {
    expect(extractCommands(command)).toEqual([{ cmd: expected, scriptArg: expected }]);
  });

  test.each<[string]>([["git status"], ["/usr/bin/touch x"]])("no script arg for %p", (command) => {
    expect(extractCommands(command)).toEqual([{ cmd: command.split(" ")[0] ?? "" }]);
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
    const result = await processInput(bashInput(`bun ${markedScriptPath}`), "linux");
    expect(result).toBeNull();
  });

  test("returns null when command is undefined", async () => {
    const input = makeInput({});
    const result = await processInput(input, "darwin");
    expect(result).toBeNull();
  });

  test("disables sandbox for marked bun script", async () => {
    const command = `bun ${markedScriptPath} --pr 42`;
    const input = bashInput(command);
    const result = await processInput(input, "darwin");
    expect(result).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        updatedInput: { command, dangerouslyDisableSandbox: true },
      },
    });
  });

  test("does not disable sandbox for unmarked bun script", async () => {
    const result = await processInput(bashInput(`bun ${unmarkedScriptPath}`), "darwin");
    expect(result).toBeNull();
  });

  test("honors marker on second bun invocation in a chain", async () => {
    const input = bashInput(`bun ${unmarkedScriptPath} && bun ${markedScriptPath}`);
    const result = await processInput(input, "darwin");
    expect(result?.hookSpecificOutput).toMatchObject({
      hookEventName: "PreToolUse",
      updatedInput: { dangerouslyDisableSandbox: true },
    });
  });

  test("disables sandbox for a marked script run directly", async () => {
    const result = await processInput(bashInput(`${markedScriptPath} --refresh`), "darwin");
    expect(result?.hookSpecificOutput).toMatchObject({
      hookEventName: "PreToolUse",
      updatedInput: { dangerouslyDisableSandbox: true },
    });
  });

  test("does not disable sandbox for an unmarked script run directly", async () => {
    const result = await processInput(bashInput(unmarkedScriptPath), "darwin");
    expect(result).toBeNull();
  });

  test("honors marker on second directly-run script in a chain", async () => {
    const input = bashInput(`${unmarkedScriptPath} && ${markedScriptPath}`);
    const result = await processInput(input, "darwin");
    expect(result?.hookSpecificOutput).toMatchObject({
      hookEventName: "PreToolUse",
      updatedInput: { dangerouslyDisableSandbox: true },
    });
  });

  test("processes Monitor tool input the same as Bash", async () => {
    const input = makeInput({ command: `bun ${markedScriptPath}` }, "Monitor");
    const result = await processInput(input, "darwin");
    expect(result?.hookSpecificOutput).toMatchObject({
      hookEventName: "PreToolUse",
      updatedInput: { dangerouslyDisableSandbox: true },
    });
  });
});
