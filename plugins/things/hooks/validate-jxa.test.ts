import { describe, expect, it } from "bun:test";
import type {
  PreToolUseHookInput,
  PreToolUseHookSpecificOutput,
} from "@anthropic-ai/claude-agent-sdk";
import { processInput } from "./validate-jxa";

const PLUGIN_ROOT = "/Users/test/.claude/plugins/things";

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
  const result = processInput(input, PLUGIN_ROOT);
  if (!result) return null;
  return result.hookSpecificOutput as PreToolUseHookSpecificOutput;
}

describe("processInput", () => {
  it("returns null for non-osascript commands", () => {
    expect(processInput(mockInput("bun scripts/query-list.ts"), PLUGIN_ROOT)).toBeNull();
    expect(processInput(mockInput("ls -la"), PLUGIN_ROOT)).toBeNull();
  });

  it("allows trusted plugin JXA scripts", () => {
    const cmd = `osascript -l JavaScript ${PLUGIN_ROOT}/scripts/jxa/find-todos.js tag claude`;
    const output = getOutput(mockInput(cmd));
    expect(output?.permissionDecision).toBe("allow");
  });

  it("allows inline Things3 JXA", () => {
    const cmd = `osascript -l JavaScript -e 'Application("Things3").lists.byId("TMTodayListSource").toDos().length'`;
    const output = getOutput(mockInput(cmd));
    expect(output?.permissionDecision).toBe("allow");
  });

  it("denies inline JXA targeting other applications", () => {
    const cmd = `osascript -l JavaScript -e 'Application("Things3").name(); Application("Finder").name()'`;
    const output = getOutput(mockInput(cmd));
    expect(output?.permissionDecision).toBe("deny");
  });

  it("returns null for osascript without -e and without plugin path", () => {
    const cmd = "osascript -l JavaScript /some/other/script.js";
    expect(processInput(mockInput(cmd), PLUGIN_ROOT)).toBeNull();
  });

  it("rejects path traversal escaping scripts/jxa directory", () => {
    const cmd = `osascript -l JavaScript ${PLUGIN_ROOT}/scripts/jxa/../../evil.js`;
    expect(processInput(mockInput(cmd), PLUGIN_ROOT)).toBeNull();
  });

  it("allows single-quoted Things3 application", () => {
    const cmd = `osascript -l JavaScript -e "Application('Things3').name()"`;
    const output = getOutput(mockInput(cmd));
    expect(output?.permissionDecision).toBe("allow");
  });

  it("returns null for inline osascript without Application calls", () => {
    const cmd = `osascript -e 'tell application "System Events" to keystroke "v"'`;
    expect(processInput(mockInput(cmd), PLUGIN_ROOT)).toBeNull();
  });
});
