import { describe, expect, test } from "bun:test";
import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { isGoBinary, processInput } from "./sandbox";

function makeInput(command: string): PreToolUseHookInput {
  return {
    tool_name: "Bash",
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

describe("processInput", () => {
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

  test("detects Go binary through pipe", async () => {
    const result = await processInput(makeInput("gh api /rate_limit | jq .rate"), "darwin");
    expect(result).not.toBeNull();
  });

  test("detects Go binary through &&", async () => {
    const result = await processInput(makeInput("echo start && gh api /rate_limit"), "darwin");
    expect(result).not.toBeNull();
  });
});
