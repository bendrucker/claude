---
paths:
  - "plugins/*/mod/**"
  - "plugins/*/hooks/hooks.json"
---

# Mods

A mod is a plugin's function-hooks module: TypeScript that the engine loads from the `modules` list in `hooks/hooks.json` and runs against engine events through `$`. Function hooks are early access and load only under `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`.

## Layout

A mod's code and tests live in `plugins/<name>/mod/`, and `hooks/hooks.json` names the entry point relative to its own directory:

```json
{ "description": "...", "modules": ["../mod/register.ts"] }
```

The entry point exports `register`, which subscribes handlers through `on`, optionally with a filter such as `{ tool: "AskUserQuestion" }` before the handler:

```ts
import type { On } from "claude-code";

export function register(on: On): void {
  on("session.start", ($, e, next) => next(e));
}
```

Every tool keys on that directory. The root tsconfig and `bun test` skip it, and lint relaxes the rules that fire on `any` there. CI and the `plugin-test` pre-commit hook run its tests. A mod imports only its own plugin's files and `claude-code`. The engine has no Node, filesystem, or npm resolution.

## Types

`import type { On } from "claude-code"` resolves against the declarations `/plugin-types` writes to `.claude/types/`, which is gitignored. Run `/plugin-types` from an interactive session and again after a Claude Code update. A `-p` run omits interactive-only tools such as `AskUserQuestion`. Each mod carries a `mod/tsconfig.json`:

```json
{ "extends": "../../../tsconfig.mod.json", "include": ["../../../.claude/types", "."] }
```

The declarations define the engine's own web globals, which would override Bun's `TextEncoder` and related types in the root program, so mod files stay out of it. Without them, `claude-code` types resolve to `any` for lint, and `bun run build` fails its type check on the missing module. CI lacks them, so its type check skips `plugins/*/mod/**`, and it checks a mod through lint, `claude plugin validate`, and its tests.

## Engine Constraints

- `$` appears as `$.noun.event(...)` at each call site or passes to a top-level function declaration. The compiler rejects a closure that takes `$`.
- A hook has 10 seconds, with the clock stopped while it waits on `$` or `next`. `session.end` shares 1.5 seconds across every hook.

## Tests

`bun scripts/mod-test.ts <plugin>` runs a mod's tests. It copies `.claude-plugin/`, `hooks/`, and `mod/` to a scratch directory first, because `claude plugin test` has no path filter and fails on the plugin's bun tests. The `claude-code/testing` kit has `describe`, `test`, `expect`, and `mock`, and no `test.each` or snapshots.
