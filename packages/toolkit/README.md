# @bendrucker/claude-plugin-toolkit

Shared hook plumbing for Claude Code plugins. Wraps [`@constellos/claude-code-kit`](https://www.npmjs.com/package/@constellos/claude-code-kit) and the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) so a plugin hook depends on a single package and import source.

## Contents

- `runHook(handler, name?)`: reads and parses stdin, runs the handler, and writes any non-null return to stdout. Call it under an `if (import.meta.main)` guard. The name used in the parse-error log defaults to a `plugin/module` value derived from `CLAUDE_PLUGIN_ROOT` and the entry script; pass `name` to override it.
- `preToolUse` / `postToolUse`: builders for hook output (`deny`, `ask`, `context`, `updatedInput`) that fill in the `hookEventName`.
- Canonical tool-input types: `WriteInput`, `EditInput`, `FileInput`, `WebFetchInput`.
- Re-exports: `readStdinJson`, `writeStdoutJson`, and the `PreToolUseHookInput`, `PostToolUseHookInput`, `SyncHookJSONOutput` types.

## Usage

```ts
import { type FileInput, postToolUse, runHook } from "@bendrucker/claude-plugin-toolkit";

if (import.meta.main) {
  runHook<PostToolUseHookInput, SyncHookJSONOutput>((input) => {
    const { file_path } = input.tool_input as FileInput;
    if (!file_path) return null;
    return postToolUse.context(`Touched ${file_path}`);
  });
}
```

Runs on [Bun](https://bun.sh), which executes the TypeScript entrypoint directly with no build step.

## Testing

```
bun test packages/toolkit
```
