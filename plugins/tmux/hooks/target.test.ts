import { describe, expect, it } from "bun:test";
import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import {
  hasExistingTarget,
  injectTarget,
  parseTmuxCommand,
  processInput,
} from "./target";

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
  it("extracts subcommand and rest", () => {
    expect(parseTmuxCommand("tmux split-window -h -d")).toEqual({
      subcommand: "split-window",
      rest: " -h -d",
    });
  });

  it("handles subcommand with no args", () => {
    expect(parseTmuxCommand("tmux split-window")).toEqual({
      subcommand: "split-window",
      rest: "",
    });
  });

  it("returns null for non-tmux command", () => {
    expect(parseTmuxCommand("ls -la")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseTmuxCommand("")).toBeNull();
  });
});

describe("hasExistingTarget", () => {
  it("detects -t mid-args", () => {
    expect(hasExistingTarget(" -t %5 -h")).toBe(true);
  });

  it("detects -t at end", () => {
    expect(hasExistingTarget(" -h -t ")).toBe(true);
  });

  it("detects standalone -t", () => {
    expect(hasExistingTarget(" -t ")).toBe(true);
  });

  it("returns false when absent", () => {
    expect(hasExistingTarget(" -h -d")).toBe(false);
  });

  it("does not match -t inside another flag", () => {
    expect(hasExistingTarget(" -target foo")).toBe(false);
  });

  it("detects -t with value attached (no space)", () => {
    expect(hasExistingTarget(" -t%3 -h")).toBe(true);
  });

  it("detects -t with quoted value attached", () => {
    expect(hasExistingTarget(' -t"%3" -h')).toBe(true);
  });
});

describe("injectTarget", () => {
  it("injects target after subcommand", () => {
    expect(injectTarget("tmux split-window -h -d", "%5")).toBe(
      'tmux split-window -t "%5" -h -d',
    );
  });

  it("injects target for alias", () => {
    expect(injectTarget("tmux splitw -h", "%5")).toBe(
      'tmux splitw -t "%5" -h',
    );
  });

  it("returns null for non-targetable command", () => {
    expect(injectTarget("tmux list-sessions", "%5")).toBeNull();
  });

  it("returns null when -t already present", () => {
    expect(injectTarget("tmux split-window -t %3 -h", "%5")).toBeNull();
  });

  it("returns null for non-tmux command", () => {
    expect(injectTarget("ls -la", "%5")).toBeNull();
  });

  it("injects target for send-keys", () => {
    expect(injectTarget("tmux send-keys C-c", "%5")).toBe(
      'tmux send-keys -t "%5" C-c',
    );
  });

  it("injects target for capture-pane", () => {
    expect(injectTarget("tmux capture-pane -p", "%5")).toBe(
      'tmux capture-pane -t "%5" -p',
    );
  });

  it("does not inject target for display-message", () => {
    expect(
      injectTarget("tmux display-message -p '#{pane_id}'", "%5"),
    ).toBeNull();
  });

  it("returns null when -t has value attached (no space)", () => {
    expect(injectTarget("tmux split-window -t%3 -h", "%5")).toBeNull();
  });
});

describe("processInput", () => {
  it("returns null when pane is undefined", () => {
    expect(processInput(mockInput("tmux split-window -h"))).toBeNull();
  });

  it("returns null when pane is empty", () => {
    expect(processInput(mockInput("tmux split-window -h"), "")).toBeNull();
  });

  it("returns null for non-targetable command", () => {
    expect(
      processInput(mockInput("tmux list-sessions"), "%5"),
    ).toBeNull();
  });

  it("returns null when -t already present", () => {
    expect(
      processInput(mockInput("tmux split-window -t %3 -h"), "%5"),
    ).toBeNull();
  });

  it("returns updatedInput and additionalContext for targetable command", () => {
    const result = processInput(mockInput("tmux split-window -h -d"), "%5");
    expect(result).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        updatedInput: {
          command: 'tmux split-window -t "%5" -h -d',
        },
        additionalContext: expect.stringContaining("-t \"%5\""),
      },
    });
  });

  it("updatedInput contains only command", () => {
    const result = processInput(mockInput("tmux send-keys C-c"), "%5");
    const updatedInput = result?.hookSpecificOutput?.updatedInput as Record<string, unknown>;
    expect(Object.keys(updatedInput)).toEqual(["command"]);
  });
});
