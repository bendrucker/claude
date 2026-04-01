# Things Plugin Development

## JXA/Bun Pipeline Architecture

JXA scripts run via `osascript`, which requires Apple Events mach-lookup services. The mac plugin's `jxa.ts` wrapper validates that scripts only target the allowed application via AST parsing, then spawns `osascript` directly. The Things plugin's `run-jxa.ts` shim discovers and delegates to the mac plugin wrapper.

**Pipeline pattern**: `bun <root>/scripts/run-jxa.ts Things3 <root>/scripts/jxa/<script> <args> | bun <root>/scripts/format-output.ts <flags>`

- JXA scripts (`scripts/jxa/*.js`) — pure data queries, return JSON via `JSON.stringify`
- Formatter (`scripts/format-output.ts`) — reads JSON from stdin, outputs tables or passes through `--json`
- `run-jxa.ts` — discovers mac plugin's `jxa.ts`, validates `Application("Things3")` scope via AST

Sandbox bypass is handled by a PreToolUse hook in `hooks/hooks.json`. The matcher is `"Bash"` with an `if` condition that narrows to plugin scripts (`Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/:*)`). The `if` field uses permission rule syntax where `|` is literal, avoiding the conflict with piped commands that the matcher's OR operator causes.

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

`scripts/reorder.ts` is a bun TypeScript script that reuses `url.ts` exports (`getAuthToken`, `buildUrl`). It opens Things URLs via `open -g` to reorder items. Unlike the JXA scripts, it does not use `osascript` — sandbox bypass comes from the `things:url` skill's inline hook.

## What NOT to Do

- **Don't use `tag.toDos().length`** for tag metadata — includes logbook items (13K+), extremely slow
