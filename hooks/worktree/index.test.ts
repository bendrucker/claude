import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import { formatAskOutput, formatDenyOutput, processInput } from "./index";

function bashInput(command: string): PreToolUseHookInput {
  return {
    tool_name: "Bash",
    tool_input: { command },
  } as PreToolUseHookInput;
}

describe("processInput", () => {
  it("denies git worktree add", () => {
    expect(processInput(bashInput("git worktree add ../path -b branch"))).toEqual(
      formatDenyOutput("add"),
    );
  });

  it("denies git worktree list", () => {
    expect(processInput(bashInput("git worktree list"))).toEqual(formatDenyOutput("list"));
  });

  it("denies git worktree remove", () => {
    expect(processInput(bashInput("git worktree remove ../path"))).toEqual(
      formatDenyOutput("remove"),
    );
  });

  it("asks for unknown git worktree subcommands", () => {
    expect(processInput(bashInput("git worktree lock ../path"))).toEqual(formatAskOutput());
    expect(processInput(bashInput("git worktree prune"))).toEqual(formatAskOutput());
  });

  it("ignores git worktree without a subcommand", () => {
    expect(processInput(bashInput("git worktree"))).toBeNull();
  });

  it("allows unrelated git commands", () => {
    expect(processInput(bashInput("git status"))).toBeNull();
    expect(processInput(bashInput("git commit -m 'fix'"))).toBeNull();
  });

  it("allows unrelated bash commands", () => {
    expect(processInput(bashInput("ls -la"))).toBeNull();
  });

  it("returns null when command is missing", () => {
    const input = { tool_name: "Bash", tool_input: {} } as PreToolUseHookInput;
    expect(processInput(input)).toBeNull();
  });
});
