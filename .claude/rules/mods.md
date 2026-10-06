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

Every tool keys on that directory. The root tsconfig and `bun test` skip it, and lint relaxes the rules that fire on `any` there. CI and the `plugin-test` pre-commit hook run its tests. A mod imports only its own plugin's files and `claude-code`. To use a dependency's types, add its `types` directory to the mod's tsconfig `include`. The engine has no Node, filesystem, or npm resolution.

## Types

`claude-code` types come from `plugins/<name>/.claude-plugin/types/`, which the engine writes when it loads a plugin from a folder (`--plugin-dir`, `CLAUDE_CODE_PLUGIN_DIRS`, the hot-reload folder), never from a marketplace install. `bun run mod-types` writes them for every mod plugin in one model-free `claude -p` run. The worktree `post-start` hook and CI run it. Rerun it after a Claude Code update. Each mod carries a `mod/tsconfig.json`:

```json
{ "extends": "../../../tsconfig.mod.json", "include": ["../.claude-plugin/types", "../../mod-events/types", "."] }
```

The declarations override Bun's web globals, so mod files stay out of the root program. The `ox` hook skips a mod whose plugin has no types yet.

A mod that draws UI through `ui.render` is written in `.tsx`, and its tsconfig adds `"jsx": "react"`, `"jsxFactory": "h"`, and `"jsxFragmentFactory": "Fragment"` to match the engine's JSX globals. It also adds `"allowImportingTsExtensions": true` so its tests can import `./register.tsx`. [`plugins/run-command/mod/tsconfig.json`](../../plugins/run-command/mod/tsconfig.json) is the example.

## Engine Constraints

- `$` appears as `$.noun.event(...)` at each call site or passes to a top-level function declaration. The compiler rejects a closure that takes `$`.
- A hook has 10 seconds, with the clock stopped while it waits on `$` or `next`. `session.end` shares 1.5 seconds across every hook.
- A hook at a gating site (`tool.call`, `tool.check`, `prompt.submit`, a call on `$`, and the others `claude plugin validate` lists under `gatingHooks`) carries a `.catch` that decides what a failure means. An observer passes it through with `.catch(($, e, next) => next(e))`, and a guard refuses. `scripts/check-gating-catch.ts` fails CI and the `plugin-test` pre-commit hook on one without it.

## Telemetry

Every mod emits through the `mod-events` plugin: list `"mod-events"` under `dependencies` in `plugin.json`, then call `void $.modEvents.emit({ mod, event, ok?, ms?, detail? })`. Emit `session.start` once from a `session.start` hook as the heartbeat, plus an event for each outcome worth querying, such as a call's exit code or a user's pick. The session index loads the events into `mod_events`, read by its `mods` query. `$.session.append` is reserved for session-limit warnings and peer messages, and each use is also emitted.

## Tests

`bun scripts/mod-test.ts <plugin>` runs a mod's tests. It copies `.claude-plugin/`, `hooks/hooks.json`, and `mod/` to a scratch directory first, because `claude plugin test` takes only the plugin folder and runs every `*.test.ts` under it, the plugin's bun tests included. It writes under `/tmp`, so it runs outside the sandbox. The `claude-code/testing` kit has `describe`, `test`, `expect`, and `mock`, and no `test.each` or snapshots.

A test's `$` carries no other plugin's noun, so a mod's test seats `$.modEvents` itself and records what reaches it:

```ts
on("engine.create", async ($, e, next) => ({
  ...(await next(e)),
  modEvents: { emit: () => Promise.resolve() },
}));
on("modEvents.emit", ($, e) => {
  events.push(e);
  return { value: undefined };
});
```
