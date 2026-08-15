# x-callback-url

Call x-callback-url schemes from the CLI and receive responses synchronously.

## Contents

### Skills

- **xcall** — Send x-callback-url requests and capture results from any supporting macOS app

### Scripts

- `scripts/main.swift` — Swift source for the xcall bridge
- `scripts/build.sh` — Compiles Swift source into `.app` bundle with URL scheme registration
- `scripts/run.sh` — Build-if-needed + invoke wrapper, with the watchdogs that bound both waits

One bundle serves every consumer, at `~/.cache/claude/x-callback-url/xcall.app`, because macOS registers exactly one handler for `xcall-claude://`.

Both shell scripts carry the `mac` plugin's `claude:dangerouslyDisableSandbox` marker. The command sandbox blocks Launch Services registration and the URL-scheme round trip alike, and a sandboxed `xcall` hangs instead of failing, so `run.sh` owns the deadline for both phases: `XCALL_BUILD_TIMEOUT_SECONDS` (exit 3) and `XCALL_TIMEOUT_SECONDS` (exit 4), 20 seconds each by default.

## Tests

`bun test plugins/x-callback-url` drives `run.sh` against stub builds and stub binaries, including ones that never finish.
