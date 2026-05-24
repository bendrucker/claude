import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { hasBypassMarker, isGoBinary, processInput } from "./sandbox";

let fixtureDir: string;
let markedScriptPath: string;
let unmarkedScriptPath: string;

beforeAll(async () => {
  fixtureDir = await mkdtemp(`${tmpdir()}${sep}sandbox-integration-`);

  markedScriptPath = join(fixtureDir, "marked.ts");
  await Bun.write(
    markedScriptPath,
    `#!/usr/bin/env bun\n// claude:dangerouslyDisableSandbox: calls a Go binary\nconsole.log("hi");\n`,
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

describe("isGoBinary", () => {
  test("gh is a Go binary", async () => {
    expect(await isGoBinary("gh")).toBe(true);
  });

  test("node is not a Go binary", async () => {
    expect(await isGoBinary("node")).toBe(false);
  });

  test("nonexistent binary returns false", async () => {
    expect(await isGoBinary("nonexistent-binary-12345")).toBe(false);
  });
});

describe("hasBypassMarker", () => {
  test("detects marker in script", async () => {
    expect(await hasBypassMarker(markedScriptPath)).toBe(true);
  });

  test("returns false for script without marker", async () => {
    expect(await hasBypassMarker(unmarkedScriptPath)).toBe(false);
  });
});

describe("processInput", () => {
  test("disables sandbox for Go binary on darwin", async () => {
    const input = makeInput("gh api /rate_limit");
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

  test("detects Go binary through pipe", async () => {
    const result = await processInput(makeInput("gh api /rate_limit | jq .rate"), "darwin");
    expect(result).not.toBeNull();
  });

  test("detects Go binary through &&", async () => {
    const result = await processInput(makeInput("echo start && gh api /rate_limit"), "darwin");
    expect(result).not.toBeNull();
  });

  test("disables sandbox for marked script under Monitor", async () => {
    const result = await processInput(
      makeInput(`bun ${markedScriptPath} --flag value`, "Monitor"),
      "darwin",
    );
    expect(result).not.toBeNull();
    expect(result?.hookSpecificOutput).toMatchObject({
      hookEventName: "PreToolUse",
      updatedInput: { dangerouslyDisableSandbox: true },
    });
  });

  test("does not disable sandbox for unmarked script under Monitor", async () => {
    const result = await processInput(
      makeInput(`bun ${unmarkedScriptPath}`, "Monitor"),
      "darwin",
    );
    expect(result).toBeNull();
  });
});
