# x-callback-url

Call x-callback-url schemes from the CLI and receive responses synchronously.

## Contents

### Skills

- **xcall** — Send x-callback-url requests and capture results from any supporting macOS app

### Scripts

- `scripts/main.swift` — Swift source for the xcall bridge
- `scripts/build.sh` — Compiles Swift source into `.app` bundle with URL scheme registration
- `scripts/run.sh` — Build-if-needed + invoke wrapper, with the watchdog that bounds the callback wait

The bundle is installed to `$CLAUDE_PLUGIN_DATA`. Claude Code does not export that variable to Bash tool calls, so a consuming skill sets it on the command it documents.

Both shell scripts carry the `mac` plugin's `claude:dangerouslyDisableSandbox` marker. The command sandbox blocks the compile and the URL-scheme round trip alike, and a sandboxed `xcall` hangs instead of failing, so `run.sh` bounds the wait at `XCALL_TIMEOUT_SECONDS` (default 20) and exits 4.
