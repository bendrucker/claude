# Things Plugin Development

## JXA/Bun Pipeline Architecture

JXA scripts run via `osascript`, which requires Apple Events mach-lookup services. The `mac:jxa-run` skill provides the JXA runner, which validates that scripts only target the allowed application via AST parsing, then spawns `osascript` directly.

**Pipeline pattern**: `/mac:jxa-run Things3 <root>/scripts/jxa/<script> <args>`, then pipe output through `bun <root>/scripts/format-output.ts <flags>`

- JXA scripts (`scripts/jxa/*.js`): pure data queries, return JSON via `JSON.stringify`
- Formatter (`scripts/format-output.ts`): reads JSON from stdin, outputs tables or passes through `--json`
- JXA execution: invoke the `mac:jxa-run` skill, which validates `Application("Things3")` scope via AST

Sandbox bypass is handled by the `mac` plugin's marker-based sandbox hook. Top-level scripts that hand off to Launch Services (`inbox.ts`, `url.ts`, `reorder.ts`) carry a `// claude:dangerouslyDisableSandbox` comment after the shebang. The mac hook reads the invoked script's head and injects `dangerouslyDisableSandbox: true`. `${CLAUDE_PLUGIN_ROOT}` does NOT expand in hook matcher fields, so a per-plugin `Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/:*)` matcher never fires. See [`plugins/mac/README.md`](../mac/README.md).

## JXA Script Conventions

JXA runs on JavaScriptCore (ES5). Scripts must:

- Use `var` (not `let`/`const`)
- Use for-loops (not `.map()`/`.filter()` — JXA arrays lack these)
- Define `function run(argv)` (osascript-native entry point)
- Return a JSON string (not an object)
- Use shebang `#!/usr/bin/env osascript -l JavaScript`
- Use `.whose()` for filtering — pushes work to Things, much faster than manual iteration

Biome linting is disabled for `scripts/jxa/` files via the root `biome.json` override.

## Reorder Script

`scripts/reorder.ts` is a bun TypeScript script that reuses `url.ts` exports (`getAuthToken`, `buildUrl`). It opens Things URLs via `open -g` to reorder items. Unlike the JXA scripts, it does not use `osascript`. Sandbox bypass comes from the `mac` plugin's marker hook, which detects the `claude:dangerouslyDisableSandbox` comment in the script head.

## What NOT to Do

- **Don't use `tag.toDos().length`** for tag metadata — includes logbook items (13K+), extremely slow
