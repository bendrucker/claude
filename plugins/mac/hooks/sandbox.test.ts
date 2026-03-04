import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { extractCommands, hasGoBuildInfo, processInput } from "./sandbox";

const fixtureDir = join(import.meta.dirname, "..", "tmp", "test-fixtures");

let goBinaryPath: string;
let plainBinaryPath: string;

beforeAll(async () => {
  goBinaryPath = join(fixtureDir, "fake-go");
  await Bun.write(goBinaryPath, `\x00__go_buildinfo\x00padding`);

  plainBinaryPath = join(fixtureDir, "fake-plain");
  await Bun.write(plainBinaryPath, `\x7fELF\x00\x00\x00\x00`);
});

afterAll(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(fixtureDir, { recursive: true, force: true });
});

function makeInput(command: string): PreToolUseHookInput {
  return {
    tool_name: "Bash",
    tool_input: { command },
  } as PreToolUseHookInput;
}

describe("extractCommands", () => {
  test("simple command", () => {
    expect(extractCommands("gh api /rate_limit")).toEqual(["gh"]);
  });

  test("pipe", () => {
    expect(extractCommands("gh api /rate_limit | jq .rate")).toEqual(["gh", "jq"]);
  });

  test("&& chain", () => {
    expect(extractCommands("terraform init && terraform plan")).toEqual(["terraform"]);
  });

  test("|| chain", () => {
    expect(extractCommands("gh pr view || echo not found")).toEqual(["gh", "echo"]);
  });

  test("; separator", () => {
    expect(extractCommands("git status; gh pr list")).toEqual(["git", "gh"]);
  });

  test("env var prefixes", () => {
    expect(extractCommands("GOFLAGS=-mod=vendor go test ./...")).toEqual(["go"]);
  });

  test("absolute path", () => {
    expect(extractCommands("/usr/local/bin/gh api /rate_limit")).toEqual(["/usr/local/bin/gh"]);
  });

  test("subshell parens", () => {
    expect(extractCommands("(gh api /rate_limit)")).toEqual(["gh"]);
  });

  test("deduplication", () => {
    expect(extractCommands("gh pr list && gh pr view 1")).toEqual(["gh"]);
  });

  test("empty input", () => {
    expect(extractCommands("")).toEqual([]);
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

describe("processInput", () => {
  test("returns null on non-darwin", async () => {
    const result = await processInput(makeInput("gh api /rate_limit"), "linux");
    expect(result).toBeNull();
  });

  test("returns null for non-Go binary", async () => {
    const result = await processInput(makeInput("echo hello"), "darwin");
    expect(result).toBeNull();
  });
});
