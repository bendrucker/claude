import type { PostToolUseInput } from "@constellos/claude-code-kit";

export function makePostToolUseInput(overrides: Partial<PostToolUseInput> = {}): PostToolUseInput {
  return {
    session_id: "test",
    transcript_path: "/tmp/transcript.jsonl",
    cwd: "/tmp",
    permission_mode: "default",
    hook_event_name: "PostToolUse",
    tool_use_id: "test-id",
    tool_name: "Write",
    tool_input: { file_path: "/tmp/file", content: "" },
    tool_response: { message: "ok", bytes_written: 0 },
    ...overrides,
  } as PostToolUseInput;
}
