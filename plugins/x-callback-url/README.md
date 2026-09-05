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

That one handler is why a callback needs to say who it belongs to. Every waiting instance is a candidate recipient for every callback, and macOS chooses among them. Each invocation therefore mints a token, carries it out on the `x-success`/`x-error`/`x-cancel` URLs, and answers only to a callback that brings the same token back. The token is stripped before the query reaches stdout. Without it an instance reports another instance's result as its own, which reads as a successful call returning the wrong id.

The token makes a stray callback harmless, not deliverable, so `run.sh` also serializes on `~/.cache/claude/x-callback-url/xcall.lock` and one invocation waits at a time (exit 5 if the bridge stays busy). The two together are what make concurrent callers safe: the token rules out a wrong answer, and the lock rules out a lost one.

Both shell scripts carry the `mac` plugin's `claude:dangerouslyDisableSandbox` marker. The command sandbox blocks Launch Services registration and the URL-scheme round trip alike, and a sandboxed `xcall` hangs instead of failing, so `run.sh` owns the deadline for both phases: `XCALL_BUILD_TIMEOUT_SECONDS` (exit 3) and `XCALL_TIMEOUT_SECONDS` (exit 4), 20 seconds each by default. A caller that waits out the lock instead exits 5, bounded by `XCALL_LOCK_WAIT_SECONDS`.

## Tests

`bun test plugins/x-callback-url` drives `run.sh` against stub builds and stub binaries, including ones that never finish.
