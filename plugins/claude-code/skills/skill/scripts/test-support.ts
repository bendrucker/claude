import type { PostToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";

export function makePostToolUseInput(
  overrides: Partial<PostToolUseHookInput> = {},
): PostToolUseHookInput {
  return {
    session_id: "test",
    transcript_path: "/tmp/transcript.jsonl",
    cwd: "/tmp",
    permission_mode: "default",
    hook_event_name: "PostToolUse",
    tool_use_id: "test-id",
    tool_name: "Write",
    tool_input: { file_path: "/tmp/file", content: "" },
    tool_response: { type: "create", filePath: "/tmp/file", content: "" },
    ...overrides,
  } as PostToolUseHookInput;
}
