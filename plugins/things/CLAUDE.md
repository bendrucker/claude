# Things Plugin Development

## JXA/Bun Pipeline Architecture

JXA scripts run via `osascript`, which requires Apple Events mach-lookup services. The `mac:jxa-run` skill provides the JXA runner, which validates that scripts only target the allowed application via AST parsing, then spawns `osascript` directly.

**Pipeline pattern**: `/mac:jxa-run Things3 <root>/scripts/jxa/<script> <args>`, then pipe output through `bun <root>/scripts/format-output.ts <flags>`

- JXA scripts (`scripts/jxa/*.js`): pure data queries, return JSON via `JSON.stringify`
- Formatter (`scripts/format-output.ts`): reads JSON from stdin, outputs tables or passes through `--json`
- JXA execution: invoke the `mac:jxa-run` skill, which validates `Application("Things3")` scope via AST

Scripts that hand off to Launch Services (`inbox.ts`, `url.ts`, `reorder.ts`) carry the `claude:dangerouslyDisableSandbox` marker so the `mac` plugin's sandbox hook runs them fully outside the command sandbox. `sandbox.allowAppleEvents` alone does not survive the handoff. See [`plugins/mac/README.md`](../mac/README.md).

## JXA Script Conventions

JXA runs on JavaScriptCore (ES5). Scripts must:

- Use `var` (not `let`/`const`)
- Use for-loops (not `.map()`/`.filter()` — JXA arrays lack these)
- Define `function run(argv)` (osascript-native entry point)
- Return a JSON string (not an object)
- Use shebang `#!/usr/bin/env osascript -l JavaScript`
- Use `.whose()` for filtering — pushes work to Things, much faster than manual iteration

Biome linting is disabled for `scripts/jxa/` files via the root `biome.json` override.

## URL Dispatch

`scripts/url.ts` owns the URL handoff. `dispatch(command, params)` builds the Things URL, runs it through the x-callback-url runner when available, and falls back to a Launch Services `open` on any xcall failure, returning the parsed todo id when xcall surfaces one. `inbox.ts`, `reorder.ts`, and `url.ts`'s own CLI call `dispatch` rather than re-implementing the runner-selection and fallback. `buildUrl`, `openUrl`, `xcall`, and `findXcallRunner` are internal to `url.ts`. Inject a `DispatchActions` to test runner selection and fallback without real Launch Services or keychain access, mirroring `plugins/gitlab/scripts/merge.ts`.

`reorder.ts` and `inbox.ts` are bun TypeScript scripts (not `osascript`). Their Launch Services handoff runs outside the command sandbox via the `claude:dangerouslyDisableSandbox` marker.

The x-callback-url bridge needs `CLAUDE_PLUGIN_DATA` to locate its `.app` bundle, and Claude Code does not export it to Bash tool calls. The `things:url` skill sets it on every documented invocation, where the substitution has already resolved it, and the three scripts inherit it. Keep that prefix on any new documented command, or the callback is lost and `dispatch` falls back to `open`.

A degraded dispatch is no longer silent. `dispatch` returns a `fallbackReason` naming why no id came back (runner missing, bridge build failed, callback timed out, app error) plus the runner's `fallbackDetail` stderr, and `warnFallback` prints both. Every caller of `dispatch` should pass its result through `warnFallback`, because the alternative is a write that lands with no id and no explanation.

## What NOT to Do

- **Don't use `tag.toDos().length`** for tag metadata — includes logbook items (13K+), extremely slow
