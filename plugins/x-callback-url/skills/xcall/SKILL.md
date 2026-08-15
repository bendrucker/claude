---
name: x-callback-url:xcall
disable-model-invocation: true
description: Call x-callback-url schemes from the CLI synchronously. Use when invoking macOS app URL schemes (Things, Bear, OmniFocus, etc.).
allowed-tools:
  - Bash
  - Read
---

# xcall

Send [x-callback-url](https://x-callback-url.com/) requests from the command line and receive responses synchronously.

## How It Works

`xcall` is a Swift CLI that builds into a macOS `.app` bundle. The `.app` is required because macOS only delivers URL scheme callbacks to registered applications. On first use, `run.sh` compiles the source into `~/.cache/claude/x-callback-url/xcall.app` and registers the callback scheme (`xcall-claude://`) with Launch Services.

There is one bundle, shared by every consuming plugin, at a path outside the plugin tree. macOS registers exactly one handler for `xcall-claude://`, and `lsregister -f` on a second bundle does not take the scheme back from the first, so a per-consumer bundle makes consumers retire each other's copies in turn. The marketplace cache is content-addressed, so a bundle built beside the source loses its registration to a deleted path on the next plugin update.

## Sandbox

Neither half of the bridge survives the command sandbox. `lsregister` cannot reach Launch Services to register the bundle, and a compiled `xcall` cannot complete the URL-scheme round trip. So `run.sh` and `build.sh` both carry the `mac` plugin's `claude:dangerouslyDisableSandbox` marker, which runs them outside it.

The marker hook reads the script named at the head of a command, past any `VAR=value` prefixes. A wrapper token in front of it (`time`, `env`, `timeout`) hides the script from the hook, the command runs sandboxed, and the callback is lost. Invoke `run.sh` by path with at most environment assignments ahead of it.

`xcall` cannot bound its own wait. Any deadline it scheduled would live in `applicationDidFinishLaunching`, which AppKit never calls when it cannot reach the WindowServer, so the sandboxed case that most needs a deadline is the one where it is never armed. `run.sh` holds both deadlines instead, from outside the process, and neither phase can wait forever:

- `XCALL_BUILD_TIMEOUT_SECONDS` (default 20) bounds the build, and exits 3
- `XCALL_TIMEOUT_SECONDS` (default 20) bounds the callback, and exits 4

## Usage

```bash
${CLAUDE_PLUGIN_ROOT}/scripts/run.sh "<url>"
```

**stdout**: `x-success` query string on success
**stderr**: `x-error` query string or timeout message
**Exit codes**: 0 = success, 1 = error, 2 = cancel, 3 = build failed, 4 = timed out waiting for the callback

## Examples

### Things 3

```bash
# Add a todo, get its ID back
${CLAUDE_PLUGIN_ROOT}/scripts/run.sh "things:///add?title=Buy%20milk"
# stdout: x-things-id=ABC123

# Update a todo, confirm it applied
${CLAUDE_PLUGIN_ROOT}/scripts/run.sh "things:///update?id=ABC123&auth-token=TOKEN&completed=true"
# stdout: x-things-id=ABC123

# Batch create via JSON
${CLAUDE_PLUGIN_ROOT}/scripts/run.sh "things:///json?data=..."
# stdout: x-things-ids=["ABC123","DEF456"]
```

### Bear

```bash
# Create a note and get its ID
${CLAUDE_PLUGIN_ROOT}/scripts/run.sh "bear://x-callback-url/create?title=Meeting%20Notes&text=..."
# stdout: identifier=ABC-123&title=Meeting%20Notes
```

## x-callback-url Protocol

The [x-callback-url](https://x-callback-url.com/specification/) protocol defines three callback parameters.

- **x-success** — called on success, with app-specific result parameters
- **x-error** — called on failure, with `errorCode` and `errorMessage`
- **x-cancel** — called when the user cancels

`xcall` appends these using its registered `xcall-claude://` scheme.

## Supported Apps

Any macOS app that supports `x-callback-url` and lacks a CLI:

- [Things 3](https://culturedcode.com/things/support/articles/2803573/) — returns `x-things-id` / `x-things-ids`
- [Bear](https://bear.app/faq/x-callback-url-scheme-documentation/) — returns note identifiers
- [OmniFocus](https://inside.omnifocus.com/url-schemes) — returns task IDs
- [Drafts](https://docs.getdrafts.com/docs/automation/urlschemes) — returns draft UUIDs

Apps with their own CLI (e.g., Shortcuts via `shortcuts run`) don't need xcall — use the CLI directly.

## Build Details

- Source: `scripts/main.swift` (~100 lines)
- Build: `scripts/build.sh` compiles to `${XDG_CACHE_HOME:-~/.cache}/claude/x-callback-url/xcall.app/`
- Bundle ID: `com.bendrucker.xcall-claude`
- Callback scheme: `xcall-claude://`
- `Info.plist`: `CFBundleTypeRole=Editor`, `LSUIElement=true`. `LSBackgroundOnly` is intentionally not set: combining it with `LSUIElement` causes macOS to refuse to route URL scheme callbacks to the app, surfacing as a "no application set" dialog.
- After building, `build.sh` calls `lsregister -f` and verifies the scheme handler is the freshly built bundle. A bundle left behind at a path an earlier version built into keeps the scheme, and `lsregister -f` does not take it back, so `build.sh` unregisters and deletes that copy before verifying. If verification still fails it exits non-zero.
- Build is cached against an `installed` stamp written next to the bundle once `lsregister` verification passes. A run that compiled but failed to register leaves no stamp, so the next call retries both
- Timeouts: see [Sandbox](#sandbox). `run.sh` owns both, and `xcall` schedules none of its own
