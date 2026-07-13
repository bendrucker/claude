import { describe, expect, it, test } from "bun:test";
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
  test.each<{ name: string; command: string; expected: "allow" | "deny" | null }>([
    {
      name: "non-open command: shortcuts run",
      command: 'shortcuts run "My Shortcut"',
      expected: null,
    },
    { name: "non-open command: ls", command: "ls -la", expected: null },
    { name: "non-open command: echo open", command: "echo open", expected: null },
    {
      name: "opens a .shortcut file",
      command: 'open "out/My Shortcut.shortcut"',
      expected: "allow",
    },
    {
      name: "single-quoted .shortcut path",
      command: "open 'out/My Shortcut.shortcut'",
      expected: "allow",
    },
    { name: "unquoted .shortcut path", command: "open out/MyShortcut.shortcut", expected: "allow" },
    {
      name: ".shortcut file with flags",
      command: 'open -W "out/My Shortcut.shortcut"',
      expected: "allow",
    },
    { name: "non-shortcut file", command: 'open "document.pdf"', expected: "deny" },
    { name: "a URL", command: "open https://example.com", expected: "deny" },
    { name: "an application", command: "open /Applications/Safari.app", expected: "deny" },
    { name: "chained with semicolons", command: "open foo.shortcut; echo pwned", expected: "deny" },
    { name: "chained with &&", command: "open foo.shortcut && rm -rf /", expected: "deny" },
  ])("$name", ({ command, expected }) => {
    const output = getOutput(mockInput(command));
    if (expected === null) {
      expect(output).toBeNull();
    } else {
      expect(output?.permissionDecision).toBe(expected);
    }
  });

  it("disables the sandbox when allowing a .shortcut file", () => {
    const output = getOutput(mockInput('open "out/My Shortcut.shortcut"'));
    expect(output?.updatedInput).toEqual({ dangerouslyDisableSandbox: true });
  });
});
