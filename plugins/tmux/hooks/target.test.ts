import { describe, expect, it, test } from "bun:test";
import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { hasExistingTarget, injectTarget, parseTmuxCommand, processInput } from "./target";

function mockInput(command: string): PreToolUseHookInput {
  return {
    hook_event_name: "PreToolUse",
    session_id: "test",
    transcript_path: "/tmp/test",
    cwd: "/tmp",
    tool_name: "Bash",
    tool_input: { command },
    tool_use_id: "test",
  };
}

describe("parseTmuxCommand", () => {
  test.each<{ name: string; input: string; expected: { subcommand: string; rest: string } | null }>(
    [
      {
        name: "extracts subcommand and rest",
        input: "tmux split-window -h -d",
        expected: { subcommand: "split-window", rest: " -h -d" },
      },
      {
        name: "handles subcommand with no args",
        input: "tmux split-window",
        expected: { subcommand: "split-window", rest: "" },
      },
      { name: "returns null for non-tmux command", input: "ls -la", expected: null },
      { name: "returns null for empty string", input: "", expected: null },
    ],
  )("$name", ({ input, expected }) => {
    expect(parseTmuxCommand(input)).toEqual(expected);
  });
});

describe("hasExistingTarget", () => {
  test.each<{ name: string; input: string; expected: boolean }>([
    { name: "detects -t mid-args", input: " -t %5 -h", expected: true },
    { name: "detects -t at end", input: " -h -t ", expected: true },
    { name: "detects standalone -t", input: " -t ", expected: true },
    { name: "returns false when absent", input: " -h -d", expected: false },
    { name: "does not match -t inside another flag", input: " -target foo", expected: false },
    { name: "detects -t with value attached (no space)", input: " -t%3 -h", expected: true },
    { name: "detects -t with quoted value attached", input: ' -t"%3" -h', expected: true },
  ])("$name", ({ input, expected }) => {
    expect(hasExistingTarget(input)).toBe(expected);
  });
});

describe("injectTarget", () => {
  test.each<{ name: string; command: string; expected: string | null }>([
    {
      name: "injects target after subcommand",
      command: "tmux split-window -h -d",
      expected: 'tmux split-window -t "%5" -h -d',
    },
    {
      name: "injects target for alias",
      command: "tmux splitw -h",
      expected: 'tmux splitw -t "%5" -h',
    },
    {
      name: "returns null for non-targetable command",
      command: "tmux list-sessions",
      expected: null,
    },
    {
      name: "returns null when -t already present",
      command: "tmux split-window -t %3 -h",
      expected: null,
    },
    { name: "returns null for non-tmux command", command: "ls -la", expected: null },
    {
      name: "injects target for send-keys",
      command: "tmux send-keys C-c",
      expected: 'tmux send-keys -t "%5" C-c',
    },
    {
      name: "injects target for capture-pane",
      command: "tmux capture-pane -p",
      expected: 'tmux capture-pane -t "%5" -p',
    },
    {
      name: "does not inject target for display-message",
      command: "tmux display-message -p '#{pane_id}'",
      expected: null,
    },
    {
      name: "returns null when -t has value attached (no space)",
      command: "tmux split-window -t%3 -h",
      expected: null,
    },
  ])("$name", ({ command, expected }) => {
    expect(injectTarget(command, "%5")).toBe(expected);
  });
});

describe("processInput", () => {
  test.each<{ name: string; command: string; pane?: string }>([
    { name: "returns null when pane is undefined", command: "tmux split-window -h" },
    { name: "returns null when pane is empty", command: "tmux split-window -h", pane: "" },
    { name: "returns null for non-targetable command", command: "tmux list-sessions", pane: "%5" },
    {
      name: "returns null when -t already present",
      command: "tmux split-window -t %3 -h",
      pane: "%5",
    },
  ])("$name", ({ command, pane }) => {
    expect(processInput(mockInput(command), pane)).toBeNull();
  });

  it("returns updatedInput and additionalContext for targetable command", () => {
    const result = processInput(mockInput("tmux split-window -h -d"), "%5");
    expect(result).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        updatedInput: {
          command: 'tmux split-window -t "%5" -h -d',
        },
        additionalContext: expect.stringContaining('-t "%5"'),
      },
    });
  });

  it("updatedInput contains only command", () => {
    const result = processInput(mockInput("tmux send-keys C-c"), "%5");
    const output = result?.hookSpecificOutput as Record<string, unknown>;
    const updatedInput = output?.updatedInput as Record<string, unknown>;
    expect(Object.keys(updatedInput)).toEqual(["command"]);
  });
});
