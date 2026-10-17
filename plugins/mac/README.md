# Mac

macOS-specific automation and system integration.

## Contents

### Skills

- **jxa** — JXA language guide for writing JavaScript for Automation code
- **jxa-run** — App-scoped JXA runner with AST-based Application() validation
- **scheduled**: Reconciles launchd agents for scheduled Claude Code runs against per-machine descriptor groups (`/mac:scheduled`)

### Hooks

- **sandbox** — Reads the invoked script for the `claude:dangerouslyDisableSandbox` marker and disables the command sandbox when present. Matches both `Bash` and `Monitor` tool calls.
- **sandbox-ssh-proxy**: `SessionStart` hook that lets sandboxed git reach SSH remotes. No-op off macOS. Self-times to `~/.claude/hook-metrics/sandbox-ssh-proxy.jsonl`.

### Scripts

- `scripts/jxa.ts` — App-scoped JXA runner with AST-based `Application()` validation
- `scripts/open-url.ts` — Scheme-scoped URL opener with scheme validation

## Sandbox

Go-based CLIs run fine sandboxed: `sandbox.network.allowMachLookup: ["com.apple.trustd.agent"]` in `user/settings.json` lets Go's `crypto/x509` reach the system `trustd` daemon for TLS verification (`gh`, `glab`, `terraform`, `kubectl`, `go`) profile-wide.

Apple Events and Launch Services handoff is different. Scripts that shell out to `osascript` (JXA) or `open` (URL schemes) do not survive the sandbox even with `sandbox.allowAppleEvents`, so they need a full skip.

### Sandbox bypass marker

The `sandbox` hook disables the command sandbox when the invoked script's first 64KB contains the literal string `claude:dangerouslyDisableSandbox`. It finds the script two ways: as the argument to `bun` or `node`, or as the command itself when a script is executed directly by path through its shebang and its extension is `.ts`, `.js`, `.mjs`, `.cjs`, or `.sh`.

Two situations warrant the marker. One is handing off to Apple Events or Launch Services, which does not survive the sandbox. The other is writing a plugin's own data dir: the sandbox profile denies writes under `~/.claude/plugins`, and that deny shadows any `filesystem.allowWrite` entry beneath it, so a plugin script cannot write `~/.claude/plugins/data/<plugin>-<marketplace>/` while sandboxed.

Add the marker after the shebang:

```ts
#!/usr/bin/env bun
// claude:dangerouslyDisableSandbox: hands off to osascript for JXA Apple Events
```

The marker goes on the top-level entrypoint script only. The hook inspects the invoked script, not imported modules, so a helper like `things/scripts/ensure-running.ts` carries no marker of its own; its callers do.

The marker is inert on Linux and inert when the `mac` plugin is not installed. It only activates when this hook runs on macOS.

### Git Over SSH

The `sandbox-ssh-proxy` hook makes git over SSH work inside the sandbox on macOS. The sandbox routes git's ssh through `GIT_SSH_COMMAND` with `ProxyCommand='nc -X 5 -x localhost:<port>'`, but its SOCKS proxy requires the per-session credentials it also puts in `ALL_PROXY`. macOS `nc` cannot send SOCKS credentials, so every sandboxed `git fetch` or `push` over SSH fails with `This proxy requires authentication, and this client did not offer an authentication method`, before ssh reaches the SSH agent. The Linux branch of the same harness code passes the credentials to `socat`, so the hook writes nothing off macOS.

The hook writes a snippet to `CLAUDE_ENV_FILE`, which each sandboxed command sources after the sandbox sets its variables. The snippet swaps in `ncat` (Homebrew `nmap`) with `--proxy-auth`. It targets `127.0.0.1` because `ncat` tries only `::1` for `localhost` and the proxy refuses that. A `git:*` sandbox exemption does not cover a pipeline into an unexcluded command, so a `git push 2>&1 | tail` takes the sandboxed path. Verified against CLI 2.1.291 with nested `claude --settings <file> -p` runs: a sandboxed `git ls-remote` over SSH failed without the hook and succeeded with it.

**Delete it** when a sandboxed `env` shows a `GIT_SSH_COMMAND` that carries the proxy credentials, at which point the snippet's `nc -X 5` match goes inert.

## Testing

```bash
bun test plugins/mac
```
