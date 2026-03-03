import { describe, expect, test } from "bun:test";
import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { extractCommands, isGoBinary, processInput } from "./sandbox";

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
    expect(extractCommands("/usr/local/bin/gh api /rate_limit")).toEqual(["gh"]);
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

describe("processInput", () => {
  test("returns null on non-darwin", async () => {
    const result = await processInput(makeInput("gh api /rate_limit"), "linux");
    expect(result).toBeNull();
  });

  test("disables sandbox for Go binary on darwin", async () => {
    const result = await processInput(makeInput("gh api /rate_limit"), "darwin");
    expect(result).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        permissionDecisionReason: expect.stringContaining("gh"),
        updatedInput: { dangerouslyDisableSandbox: true },
      },
    });
  });

  test("returns null for non-Go binary", async () => {
    const result = await processInput(makeInput("echo hello"), "darwin");
    expect(result).toBeNull();
  });

  test("detects Go binary through pipe", async () => {
    const result = await processInput(makeInput("gh api /rate_limit | jq .rate"), "darwin");
    expect(result).not.toBeNull();
  });

  test("detects Go binary through &&", async () => {
    const result = await processInput(makeInput("echo start && gh api /rate_limit"), "darwin");
    expect(result).not.toBeNull();
  });
});
