# @bendrucker/claude-plugin-toolkit

Typed adapters for Claude Code plugin hooks. Thin helpers over the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) hook types so a hook reads stdin, builds its output by the SDK's own field names, and writes stdout, all from one import source.

The builders mirror the hook API rather than renaming it. The output field is `additionalContext`, so the builder is `additionalContext`. `deny`/`ask` are the one bit of sugar, shorthands for a `permissionDecision` plus its reason.

## Contents

- `runHook(handler, name?)`: reads and parses stdin, runs the handler, and writes any non-null return to stdout. Call it under an `if (import.meta.main)` guard. The name used in the error log defaults to a `plugin/module` value derived from `CLAUDE_PLUGIN_ROOT` and the entry script; pass `name` to override it.
- `preToolUse`: builds a `PreToolUse` `hookSpecificOutput`. `deny(reason)` and `ask(reason)` set the `permissionDecision`. `additionalContext(text)` and `updatedInput(input, additionalContext?)` set those fields by name.
- `postToolUse`: `additionalContext(text)` builds a `PostToolUse` `hookSpecificOutput`.
- Canonical tool-input types: `WriteInput`, `EditInput`, `FileInput`, `WebFetchInput`.
- `readStdinJson` / `writeStdoutJson`: the stdin/stdout JSON primitives `runHook` is built on, exported for hooks that need them directly.
- Re-exported SDK types: `PreToolUseHookInput`, `PostToolUseHookInput`, `PreToolUseHookSpecificOutput`, `PostToolUseHookSpecificOutput`, `SyncHookJSONOutput`.

## Usage

```ts
import { type FileInput, postToolUse, runHook } from "@bendrucker/claude-plugin-toolkit";

if (import.meta.main) {
  runHook<PostToolUseHookInput, SyncHookJSONOutput>((input) => {
    const { file_path } = input.tool_input as FileInput;
    if (!file_path) return null;
    return postToolUse.additionalContext(`Touched ${file_path}`);
  });
}
```

Runs on [Bun](https://bun.sh), which executes the TypeScript entrypoint directly with no build step.

## Testing

```
bun test packages/toolkit
```
