import { type FileInput, postToolUse, runHook } from "../index";

if (import.meta.main) {
  runHook<{ tool_input: FileInput }, ReturnType<typeof postToolUse.context>>((input) => {
    const { file_path } = input.tool_input;
    if (!file_path) return null;
    if (file_path === "THROW") throw new Error("handler boom");
    return postToolUse.context(file_path);
  }, process.env.HOOK_NAME_OVERRIDE);
}
