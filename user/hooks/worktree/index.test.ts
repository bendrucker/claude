import { describe, expect, it } from "bun:test";
import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import {
  formatAskOutput,
  formatDenyOutput,
  isThrowawayAdd,
  isThrowawayRemove,
  processInput,
} from "./index";

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

  it("allows git worktree remove under tmp/", () => {
    expect(processInput(bashInput("git worktree remove tmp/verify"))).toBeNull();
  });

  it("allows git worktree remove --force under tmp/", () => {
    expect(processInput(bashInput("git worktree remove --force tmp/verify"))).toBeNull();
  });

  it("allows git worktree remove of agent worktrees", () => {
    expect(processInput(bashInput("git worktree remove .claude/worktrees/agent-x"))).toBeNull();
    expect(
      processInput(bashInput("git worktree remove /Users/me/repo/.claude/worktrees/agent-x")),
    ).toBeNull();
  });

  it("denies git worktree remove", () => {
    expect(processInput(bashInput("git worktree remove ../path"))).toEqual(
      formatDenyOutput("remove"),
    );
  });

  it("allows git worktree prune and unlock", () => {
    expect(processInput(bashInput("git worktree prune"))).toBeNull();
    expect(processInput(bashInput("git worktree prune --verbose"))).toBeNull();
    expect(processInput(bashInput("git worktree unlock tmp/verify"))).toBeNull();
    expect(processInput(bashInput("git worktree unlock ../path"))).toBeNull();
  });

  it("asks for unknown git worktree subcommands", () => {
    expect(processInput(bashInput("git worktree lock ../path"))).toEqual(formatAskOutput());
    expect(processInput(bashInput("git worktree repair"))).toEqual(formatAskOutput());
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

describe("isThrowawayRemove", () => {
  it("matches a tmp/ target", () => {
    expect(isThrowawayRemove("git worktree remove tmp/x")).toBe(true);
  });

  it("matches a ./tmp/ target", () => {
    expect(isThrowawayRemove("git worktree remove ./tmp/x")).toBe(true);
  });

  it("matches a relative .claude/worktrees/ target", () => {
    expect(isThrowawayRemove("git worktree remove .claude/worktrees/agent-x")).toBe(true);
  });

  it("matches an absolute .claude/worktrees/ target", () => {
    expect(isThrowawayRemove("git worktree remove /Users/me/repo/.claude/worktrees/agent-x")).toBe(
      true,
    );
  });

  it("skips flags and matches a later tmp/ target", () => {
    expect(isThrowawayRemove("git worktree remove --force tmp/x")).toBe(true);
  });

  it("does not match a tmp-prefixed sibling directory", () => {
    expect(isThrowawayRemove("git worktree remove tmpfoo/x")).toBe(false);
  });

  it("does not match tmp/ nested below another directory", () => {
    expect(isThrowawayRemove("git worktree remove a/tmp/x")).toBe(false);
  });

  it("does not match a worktrees dir outside .claude/", () => {
    expect(isThrowawayRemove("git worktree remove worktrees/x")).toBe(false);
  });

  it("does not match other subcommands", () => {
    expect(isThrowawayRemove("git worktree add tmp/x")).toBe(false);
  });
});
