import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { extractCommands, hasBypassMarker, hasGoBuildInfo, processInput } from "./sandbox";

let fixtureDir: string;
let goBinaryPath: string;
let plainBinaryPath: string;
let markedScriptPath: string;
let unmarkedScriptPath: string;

beforeAll(async () => {
  fixtureDir = await mkdtemp(`${tmpdir()}${sep}sandbox-test-`);

  goBinaryPath = join(fixtureDir, "fake-go");
  await Bun.write(goBinaryPath, `\x00__go_buildinfo\x00padding`);

  plainBinaryPath = join(fixtureDir, "fake-plain");
  await Bun.write(plainBinaryPath, `\x7fELF\x00\x00\x00\x00`);

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

describe("extractCommands", () => {
  test("simple command", () => {
    expect(extractCommands("gh api /rate_limit")).toEqual([{ cmd: "gh" }]);
  });

  test("pipe", () => {
    expect(extractCommands("gh api /rate_limit | jq .rate")).toEqual([
      { cmd: "gh" },
      { cmd: "jq" },
    ]);
  });

  test("&& chain", () => {
    expect(extractCommands("terraform init && terraform plan")).toEqual([{ cmd: "terraform" }]);
  });

  test("|| chain", () => {
    expect(extractCommands("gh pr view || echo not found")).toEqual([
      { cmd: "gh" },
      { cmd: "echo" },
    ]);
  });

  test("; separator", () => {
    expect(extractCommands("git status; gh pr list")).toEqual([{ cmd: "git" }, { cmd: "gh" }]);
  });

  test("env var prefixes", () => {
    expect(extractCommands("GOFLAGS=-mod=vendor go test ./...")).toEqual([{ cmd: "go" }]);
  });

  test("absolute path", () => {
    expect(extractCommands("/usr/local/bin/gh api /rate_limit")).toEqual([
      { cmd: "/usr/local/bin/gh" },
    ]);
  });

  test("subshell parens", () => {
    expect(extractCommands("(gh api /rate_limit)")).toEqual([{ cmd: "gh" }]);
  });

  test("deduplication", () => {
    expect(extractCommands("gh pr list && gh pr view 1")).toEqual([{ cmd: "gh" }]);
  });

  test("empty input", () => {
    expect(extractCommands("")).toEqual([]);
  });

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

  test("skips bun flag-bearing invocation", () => {
    expect(extractCommands("bun --silent watch.ts")).toEqual([{ cmd: "bun" }]);
  });

  test("absolute bun script path", () => {
    expect(extractCommands("bun /abs/path/watch.ts")).toEqual([
      { cmd: "bun", scriptArg: "/abs/path/watch.ts" },
    ]);
  });
});

describe("hasGoBuildInfo", () => {
  test("detects Go binary marker", async () => {
    expect(await hasGoBuildInfo(goBinaryPath)).toBe(true);
  });

  test("rejects binary without marker", async () => {
    expect(await hasGoBuildInfo(plainBinaryPath)).toBe(false);
  });

  test("returns false for nonexistent path", async () => {
    expect(await hasGoBuildInfo("/nonexistent/path")).toBe(false);
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
    const result = await processInput(makeInput(`${goBinaryPath} api /rate_limit`), "linux");
    expect(result).toBeNull();
  });

  test("returns null for non-Go binary", async () => {
    const result = await processInput(makeInput("echo hello"), "darwin");
    expect(result).toBeNull();
  });

  test("disables sandbox for Go binary on darwin", async () => {
    const input = makeInput(`${goBinaryPath} api /rate_limit`);
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

  test("returns null when command is undefined", async () => {
    const input = { tool_name: "Bash", tool_input: {} } as PreToolUseHookInput;
    const result = await processInput(input, "darwin");
    expect(result).toBeNull();
  });

  test("detects Go binary through pipe", async () => {
    const result = await processInput(
      makeInput(`${goBinaryPath} api /rate_limit | jq .rate`),
      "darwin",
    );
    expect(result).not.toBeNull();
  });

  test("detects Go binary through &&", async () => {
    const result = await processInput(
      makeInput(`echo start && ${goBinaryPath} api /rate_limit`),
      "darwin",
    );
    expect(result).not.toBeNull();
  });

  test("disables sandbox for marked bun script", async () => {
    const input = makeInput(`bun ${markedScriptPath} --pr 42`);
    const result = await processInput(input, "darwin");
    expect(result).not.toBeNull();
    expect(result?.hookSpecificOutput).toMatchObject({
      hookEventName: "PreToolUse",
      updatedInput: { dangerouslyDisableSandbox: true },
    });
  });

  test("does not disable sandbox for unmarked bun script", async () => {
    const result = await processInput(makeInput(`bun ${unmarkedScriptPath}`), "darwin");
    expect(result).toBeNull();
  });

  test("processes Monitor tool input the same as Bash", async () => {
    const input = makeInput(`bun ${markedScriptPath}`, "Monitor");
    const result = await processInput(input, "darwin");
    expect(result).not.toBeNull();
    expect(result?.hookSpecificOutput).toMatchObject({
      hookEventName: "PreToolUse",
      updatedInput: { dangerouslyDisableSandbox: true },
    });
  });
});
