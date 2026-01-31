import { describe, expect, it } from "bun:test";
import type {
  PreToolUseHookInput,
  PreToolUseHookSpecificOutput,
} from "@anthropic-ai/claude-agent-sdk";
import { processInput } from "./open";

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

function getOutput(input: PreToolUseHookInput): PreToolUseHookSpecificOutput | null {
  const result = processInput(input);
  if (!result) return null;
  return result.hookSpecificOutput as PreToolUseHookSpecificOutput;
}

describe("processInput", () => {
  it("returns null for non-open commands", () => {
    expect(processInput(mockInput('shortcuts run "My Shortcut"'))).toBeNull();
    expect(processInput(mockInput("ls -la"))).toBeNull();
    expect(processInput(mockInput("echo open"))).toBeNull();
  });

  it("allows opening a .shortcut file", () => {
    const output = getOutput(mockInput('open "out/My Shortcut.shortcut"'));
    expect(output?.permissionDecision).toBe("allow");
    expect(output?.updatedInput).toEqual({ dangerouslyDisableSandbox: true });
  });

  it("allows single-quoted .shortcut path", () => {
    const output = getOutput(mockInput("open 'out/My Shortcut.shortcut'"));
    expect(output?.permissionDecision).toBe("allow");
  });

  it("allows unquoted .shortcut path", () => {
    const output = getOutput(mockInput("open out/MyShortcut.shortcut"));
    expect(output?.permissionDecision).toBe("allow");
  });

  it("denies opening non-shortcut files", () => {
    const output = getOutput(mockInput('open "document.pdf"'));
    expect(output?.permissionDecision).toBe("deny");
  });

  it("denies opening a URL", () => {
    const output = getOutput(mockInput("open https://example.com"));
    expect(output?.permissionDecision).toBe("deny");
  });

  it("denies opening an application", () => {
    const output = getOutput(mockInput("open /Applications/Safari.app"));
    expect(output?.permissionDecision).toBe("deny");
  });

  it("allows .shortcut file with flags", () => {
    const output = getOutput(mockInput('open -W "out/My Shortcut.shortcut"'));
    expect(output?.permissionDecision).toBe("allow");
  });

  it("denies when command is chained with semicolons", () => {
    const output = getOutput(mockInput("open foo.shortcut; echo pwned"));
    expect(output?.permissionDecision).toBe("deny");
  });

  it("denies when command is chained with &&", () => {
    const output = getOutput(mockInput("open foo.shortcut && rm -rf /"));
    expect(output?.permissionDecision).toBe("deny");
  });
});
