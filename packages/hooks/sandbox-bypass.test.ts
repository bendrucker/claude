import { describe, it, expect } from "vitest";
import type {
  PreToolUseHookInput,
  PreToolUseHookSpecificOutput,
} from "@anthropic-ai/claude-agent-sdk";
import { createSandboxBypass } from "./sandbox-bypass";

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

function getOutput(
  input: PreToolUseHookInput,
  options?: Parameters<typeof createSandboxBypass>[0],
): PreToolUseHookSpecificOutput {
  const processInput = createSandboxBypass(options);
  return processInput(input)
    .hookSpecificOutput as PreToolUseHookSpecificOutput;
}

describe("createSandboxBypass", () => {
  it("auto-allows and disables sandbox when no options provided", () => {
    const output = getOutput(mockInput("swift cal.swift calendars"));
    expect(output.permissionDecision).toBe("allow");
    expect(output.updatedInput).toEqual({
      dangerouslyDisableSandbox: true,
    });
  });

  it("auto-allows commands matching the autoAllow predicate", () => {
    const output = getOutput(
      mockInput("swift cal.swift list --start 2026-01-27 --end 2026-01-28"),
      {
        autoAllow: (cmd) =>
          /cal\.swift\s+(calendars|list|get)\b/.test(cmd),
      },
    );
    expect(output.permissionDecision).toBe("allow");
    expect(output.updatedInput).toEqual({
      dangerouslyDisableSandbox: true,
    });
  });

  it("disables sandbox without auto-allow for non-matching commands", () => {
    const output = getOutput(
      mockInput("swift cal.swift create --title Test"),
      {
        autoAllow: (cmd) =>
          /cal\.swift\s+(calendars|list|get)\b/.test(cmd),
      },
    );
    expect(output.permissionDecision).toBeUndefined();
    expect(output.updatedInput).toEqual({
      dangerouslyDisableSandbox: true,
    });
  });

  it("handles empty command", () => {
    const output = getOutput(mockInput(""), {
      autoAllow: (cmd) => /cal\.swift/.test(cmd),
    });
    expect(output.permissionDecision).toBeUndefined();
    expect(output.updatedInput).toEqual({
      dangerouslyDisableSandbox: true,
    });
  });

  it("handles missing command in tool_input", () => {
    const input: PreToolUseHookInput = {
      hook_event_name: "PreToolUse",
      session_id: "test",
      transcript_path: "/tmp/test",
      cwd: "/tmp",
      tool_name: "Bash",
      tool_input: {},
      tool_use_id: "test",
    };
    const processInput = createSandboxBypass();
    const output = processInput(input)
      .hookSpecificOutput as PreToolUseHookSpecificOutput;
    expect(output.permissionDecision).toBe("allow");
    expect(output.updatedInput).toEqual({
      dangerouslyDisableSandbox: true,
    });
  });
});
