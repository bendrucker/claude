import { describe, expect, test } from "bun:test";
import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { processInput } from "./cli-create";

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

describe("processInput", () => {
  test.each([
    ["bare create injects Backlog", "linear issue create --title x --team BEN"],
    ["create with -a self injects Todo", "linear issue create --title x -a self"],
    ["create with --assignee injects Todo", "linear issue create --title x --assignee self"],
    ["create with --assignee= injects Todo", "linear issue create --title x --assignee=self"],
    ["existing -s passes through", "linear issue create --title x -s Todo"],
    ["existing --state= passes through", "linear issue create --title x --state=Todo"],
    ["--start passes through", "linear issue create --title x --start"],
    [
      "command substitution with a pipe is denied",
      "id=$(linear issue create --title x --team BEN | grep -oE 'BEN-[0-9]+')",
    ],
    [
      "an && chain is denied",
      "linear issue create --title x --team BEN && linear issue view BEN-1",
    ],
    ["env-prefixed invocation is rewritten", "LINEAR_API_KEY=abc linear issue create --title x"],
    ["issue update does not fire", "linear issue update BEN-1 --title x"],
    ["a create mentioned inside a title does not fire", "echo 'linear issue create'"],
    ["trailing whitespace is trimmed before the flag", "linear issue create --title x  "],
  ])("%s", (_name, command) => {
    expect(processInput(mockInput(command))).toMatchSnapshot();
  });
});
