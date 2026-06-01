---
name: x-callback-url:xcall
description: Call x-callback-url schemes from the CLI synchronously. Use when invoking macOS app URL schemes (Things, Bear, OmniFocus, etc.).
allowed-tools:
  - Bash
  - Read
---

# xcall

Send [x-callback-url](https://x-callback-url.com/) requests from the command line and receive responses synchronously.

## How It Works

`xcall` is a Swift CLI that builds into a macOS `.app` bundle. The `.app` is required because macOS only delivers URL scheme callbacks to registered applications. On first use, `run.sh` compiles the source into `${CLAUDE_PLUGIN_DATA}/xcall.app` and registers the callback scheme (`xcall-claude://`) with Launch Services. Installing into the plugin's data directory (instead of the plugin source/cache tree) keeps the registered path stable across plugin updates: the marketplace cache is content-addressed, so building xcall.app inside it would orphan the Launch Services registration on the next update.

## Usage

```bash
${CLAUDE_PLUGIN_ROOT}/scripts/run.sh "<url>"
```

**stdout**: `x-success` query string on success
**stderr**: `x-error` query string or timeout message
**Exit codes**: 0 = success, 1 = error, 2 = cancel

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

The [x-callback-url](https://x-callback-url.com/specification/) protocol defines three callback parameters:

- **x-success** — called on success, with app-specific result parameters
- **x-error** — called on failure, with `errorCode` and `errorMessage`
- **x-cancel** — called when the user cancels

`xcall` appends these automatically using its registered `xcall-claude://` scheme.

## Supported Apps

Any macOS app that supports `x-callback-url` and lacks a CLI:

- [Things 3](https://culturedcode.com/things/support/articles/2803573/) — returns `x-things-id` / `x-things-ids`
- [Bear](https://bear.app/faq/x-callback-url-scheme-documentation/) — returns note identifiers
- [OmniFocus](https://inside.omnifocus.com/url-schemes) — returns task IDs
- [Drafts](https://docs.getdrafts.com/docs/automation/urlschemes) — returns draft UUIDs

Apps with their own CLI (e.g., Shortcuts via `shortcuts run`) don't need xcall — use the CLI directly.

## Build Details

- Source: `scripts/main.swift` (~100 lines)
- Build: `scripts/build.sh` compiles to `${CLAUDE_PLUGIN_DATA}/xcall.app/`. The script exits non-zero if `CLAUDE_PLUGIN_DATA` is unset.
- Bundle ID: `com.bendrucker.xcall-claude`
- Callback scheme: `xcall-claude://`
- `Info.plist`: `CFBundleTypeRole=Editor`, `LSUIElement=true`. `LSBackgroundOnly` is intentionally not set: combining it with `LSUIElement` causes macOS to refuse to route URL scheme callbacks to the app, surfacing as a "no application set" dialog.
- After building, `build.sh` calls `lsregister -f` and verifies the scheme handler is the freshly built bundle. If verification fails it exits non-zero.
- Build is cached — only recompiles if `main.swift` is newer than the binary
- Timeout: 10 seconds
