# Things Plugin Development

## JXA/Bun Pipeline Architecture

JXA scripts run via `osascript`, which requires Apple Events mach-lookup services (`com.apple.CoreServices.coreservicesd`, `com.apple.tccd.system`). Claude Code's seatbelt sandbox blocks these when `osascript` runs as a child of `bun` (via `run-jxa`). Since `osascript:*` is in `sandbox.excludedCommands`, making `osascript` the top-level command bypasses the sandbox naturally.

**Pipeline pattern**: `osascript -l JavaScript <jxa-script> <args> | bun <formatter> <flags>`

- JXA scripts (`scripts/jxa/*.js`) — pure data queries, return JSON via `JSON.stringify`
- Formatter (`scripts/format-output.ts`) — reads JSON from stdin, outputs tables or passes through `--json`

## JXA Script Conventions

JXA runs on JavaScriptCore (ES5). Scripts must:

- Use `var` (not `let`/`const`)
- Use for-loops (not `.map()`/`.filter()` — JXA arrays lack these)
- Define `function run(argv)` (osascript-native entry point)
- Return a JSON string (not an object)
- Use shebang `#!/usr/bin/env osascript -l JavaScript`
- Use `.whose()` for filtering — pushes work to Things, much faster than manual iteration

Biome linting is disabled for `scripts/jxa/` files via the root `biome.json` override.

## What NOT to Do

- **Don't use `run-jxa`** — spawns `osascript` as a child of `bun`, inheriting the sandbox
- **Don't spawn `osascript` from Bun/Node** — same sandbox inheritance problem
- **Don't use `tag.toDos().length`** for tag metadata — includes logbook items (13K+), extremely slow
