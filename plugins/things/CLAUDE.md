# Things Plugin Development

## JXA/Bun Pipeline Architecture

JXA scripts run via `osascript`, which requires Apple Events mach-lookup services. The `mac:jxa-run` skill provides the JXA runner, which validates that scripts only target the allowed application via AST parsing, then spawns `osascript` directly.

**Pipeline pattern**: `/mac:jxa-run Things3 <root>/scripts/jxa/<script> <args>`, then pipe output through `bun <root>/scripts/format-output.ts <flags>`

- JXA scripts (`scripts/jxa/*.js`): pure data queries, return JSON via `JSON.stringify`
- Formatter (`scripts/format-output.ts`): reads JSON from stdin, outputs tables or passes through `--json`
- JXA execution: invoke the `mac:jxa-run` skill, which validates `Application("Things3")` scope via AST

Scripts that hand off to Launch Services (`inbox.ts`, `url.ts`, `reorder.ts`, `src/mcp/stdio.ts`) carry the `claude:dangerouslyDisableSandbox` marker so the `mac` plugin's sandbox hook runs them fully outside the command sandbox. `sandbox.allowAppleEvents` alone does not survive the handoff. See [`plugins/mac/README.md`](../mac/README.md).

## JXA Script Conventions

JXA runs on JavaScriptCore (ES5). Scripts must:

- Use `var` (not `let`/`const`)
- Use for-loops (not `.map()`/`.filter()` — JXA arrays lack these)
- Define `function run(argv)` (osascript-native entry point)
- Return a JSON string (not an object)
- Use shebang `#!/usr/bin/env osascript -l JavaScript`
- Use `.whose()` for filtering — pushes work to Things, much faster than manual iteration

Linting is disabled for the `.js` files in `scripts/jxa/` via `ignorePatterns` in the root `.oxlintrc.json`. The pattern is `**/jxa/**/*.js`, so a `.ts` file added there would still be linted.

## URL Dispatch

`scripts/url.ts` owns the URL handoff. `dispatch(command, params)` builds the Things URL, runs it through the x-callback-url runner when available, and falls back to a Launch Services `open` on any xcall failure, returning the parsed todo id when xcall surfaces one. `inbox.ts`, `reorder.ts`, and `url.ts`'s own CLI call `dispatch` rather than re-implementing the runner-selection and fallback. `buildUrl`, `openUrl`, and `xcall` are internal to `url.ts`. Inject a `DispatchActions` to test runner selection and fallback without real Launch Services or keychain access, mirroring `plugins/gitlab/scripts/merge.ts`.

`findXcallRunner` resolves the runner from two layouts: a sibling plugin directory in the dev checkout, and `<marketplace>/x-callback-url/<version>/scripts/run.sh` when installed, where `<version>` is the marketplace commit this plugin was installed from. It accepts no other version. `xcallBackstopMs` sizes its timeout from this build's own view of `run.sh`'s bounds, and only the same-commit runner is known to honor them, so a mismatched runner could outlive the backstop and die on a signal instead of naming its own failure.

It takes the plugin root as an argument and is exported so tests can point it at a fixture tree. Injecting it through `DispatchActions` covers what `dispatch` does with a runner, never how one gets found, so the resolver needs its own fixtures across both layouts.

`reorder.ts` and `inbox.ts` are bun TypeScript scripts (not `osascript`). Their Launch Services handoff runs outside the command sandbox via the `claude:dangerouslyDisableSandbox` marker.

A degraded dispatch is no longer silent. `dispatch` returns a `fallbackReason` naming why no id came back (runner missing, bridge build failed, callback timed out, app error) plus the runner's `fallbackDetail` stderr, and `warnFallback` prints both. Every caller of `dispatch` should pass its result through `warnFallback`, because the alternative is a write that lands with no id and no explanation.

`xcallBackstopMs` in `url.ts` guards a runner that dies without honoring its own watchdogs. It reads `run.sh`'s two bounds from the environment and adds a margin, so raising either bound cannot make the backstop kill the runner before it names its own failure.

## MCP Server

`src/mcp/stdio.ts` serves the same reads and writes over stdio for tailgate, reusing `url.ts`, `inbox.ts`, `reorder.ts`, and `ensure-running.ts`. stdout there is the JSON-RPC channel, so anything those modules print at runtime corrupts the protocol.

Keep `console.log` under `import.meta.main`. A function both the CLI and a tool call returns its result and lets the CLI print it. Send diagnostics to stderr, which tailgate logs. Pipe or `.quiet()` every subprocess, including Bun's `$`, which inherits stdout by default. `src/mcp/stdio.test.ts` fails on any stdout line that will not parse as JSON.

`src/mcp/tags.ts` gates every tag-carrying write on the tags Things already holds, because Things drops an unknown tag and still reports success. The matching itself is pure and lives in `scripts/tags.ts`; the module here is the IO shell, with the fetch and the create behind a `TagActions` seam the way `dispatch` puts its runner behind `DispatchActions`. `scripts/inbox.ts` routes its CLI capture through the same requirer, so the CLI and the tool agree on which tags exist.

A list read returns a notes preview per todo, capped at `NOTES_PREVIEW_CHARS`, and `get-todo.js` serves one todo's full notes on request. Notes are most of what a list read weighs, and a client's framing has a hard ceiling, so shipping them everywhere buys a few dozen todos instead of a few hundred. The read scripts also take `--limit`, which breaks the walk rather than slicing the result: each todo visited costs several Apple Events, so the limit is a scan bound.

A `.whose()` predicate only pays off when the collection it scopes is small or the predicate is one Things can answer. Text predicates against the top-level `toDos` answer in well under a second; date predicates and text predicates scoped to the logbook list do not return inside two minutes. Things also keeps working on a predicate whose Apple Event already timed out, so one such call degrades the calls after it.

`src/mcp/jxa.ts` resolves the `mac` plugin's JXA runner across the same two layouts as `findXcallRunner`, and accepts only the sibling under this plugin's own version directory. The runner's argument contract is versioned: this build expects the runner to forward everything past the script path to the script itself, and a runner from another commit may claim those flags and leave the script answering with a usage error. `findJxaRunner` takes the plugin root as an argument so tests can point it at a fixture tree.

## What NOT to Do

- **Don't use `tag.toDos().length`** for tag metadata — includes logbook items (13K+), extremely slow
