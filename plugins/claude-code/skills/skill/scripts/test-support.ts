import type { HookInput } from "./hook-input";

export function makePostToolUseInput(overrides: Partial<HookInput> = {}): HookInput {
  return {
    tool_name: "Write",
    tool_input: { file_path: "/tmp/file", content: "" },
    ...overrides,
  };
}
