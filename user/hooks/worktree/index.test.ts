import { describe, expect, it } from "bun:test";
import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { formatAskOutput, formatDenyOutput, isThrowawayAdd, processInput } from "./index";

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

  it("allows git worktree list", () => {
    expect(processInput(bashInput("git worktree list"))).toBeNull();
  });

  it("allows git worktree add under tmp/", () => {
    expect(processInput(bashInput("git worktree add tmp/verify"))).toBeNull();
  });

  it("allows git worktree add under ./tmp/ with a commit-ish", () => {
    expect(processInput(bashInput("git worktree add ./tmp/verify HEAD"))).toBeNull();
  });

  it("allows git worktree add --detach under tmp/", () => {
    expect(processInput(bashInput("git worktree add --detach tmp/verify"))).toBeNull();
  });

  it("allows git worktree add with a flag value before the tmp path", () => {
    expect(processInput(bashInput("git worktree add -b throwaway tmp/verify"))).toBeNull();
  });

  it("denies git worktree add outside tmp/", () => {
    expect(processInput(bashInput("git worktree add ../path -b branch"))).toEqual(
      formatDenyOutput("add"),
    );
  });

  it("denies git worktree add to a path that merely contains tmp/", () => {
    expect(processInput(bashInput("git worktree add notmp/foo"))).toEqual(formatDenyOutput("add"));
    expect(processInput(bashInput("git worktree add a/tmp/foo"))).toEqual(formatDenyOutput("add"));
  });

  it("denies git worktree add under .worktrees/", () => {
    expect(processInput(bashInput("git worktree add .worktrees/foo"))).toEqual(
      formatDenyOutput("add"),
    );
  });

  it("denies git worktree remove under tmp/", () => {
    expect(processInput(bashInput("git worktree remove tmp/verify"))).toEqual(
      formatDenyOutput("remove"),
    );
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

describe("isThrowawayAdd", () => {
  it("matches a tmp/ target", () => {
    expect(isThrowawayAdd("git worktree add tmp/x")).toBe(true);
  });

  it("matches a ./tmp/ target", () => {
    expect(isThrowawayAdd("git worktree add ./tmp/x")).toBe(true);
  });

  it("does not match a tmp-prefixed sibling directory", () => {
    expect(isThrowawayAdd("git worktree add tmpfoo/x")).toBe(false);
  });

  it("does not match tmp/ nested below another directory", () => {
    expect(isThrowawayAdd("git worktree add a/tmp/x")).toBe(false);
  });
});
