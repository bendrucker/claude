# Mac

macOS-specific automation and system integration.

## Contents

### Skills

- The **jxa** skill is a JXA language guide for writing JavaScript for Automation code.
- The **jxa-run** skill is an app-scoped JXA runner with AST-based Application() validation.

### Hooks

- The **sandbox** hook reads the invoked script for the `claude:dangerouslyDisableSandbox` marker and disables the command sandbox when present. It matches both `Bash` and `Monitor` tool calls.
- The `sandbox-ssh-proxy` hook runs at `SessionStart` and lets sandboxed git reach SSH remotes on macOS ([details](hooks/sandbox-ssh-proxy.md)).

### Scripts

- `scripts/jxa.ts` is an app-scoped JXA runner with AST-based `Application()` validation.
- `scripts/open-url.ts` is a scheme-scoped URL opener with scheme validation.

## Sandbox

Go-based CLIs run fine sandboxed: `sandbox.network.allowMachLookup: ["com.apple.trustd.agent"]` in `user/settings.json` lets Go's `crypto/x509` reach the system `trustd` daemon for TLS verification (`gh`, `glab`, `terraform`, `kubectl`, `go`) profile-wide.

Apple Events and Launch Services handoff is different. Scripts that shell out to `osascript` (JXA) or `open` (URL schemes) do not survive the sandbox even with `sandbox.allowAppleEvents`. They need a full skip.

### Sandbox bypass marker

The `sandbox` hook disables the command sandbox when the invoked script's first 64KB contains the literal string `claude:dangerouslyDisableSandbox`. It finds the script two ways: as the argument to `bun` or `node`, or as the command itself when a script is executed directly by path through its shebang and its extension is `.ts`, `.js`, `.mjs`, `.cjs`, or `.sh`.

Two situations warrant the marker. One is handing off to Apple Events or Launch Services, which does not survive the sandbox. The other is writing a plugin's own data dir: the sandbox profile denies writes under `~/.claude/plugins`, and that deny shadows any `filesystem.allowWrite` entry beneath it. As a result, a plugin script cannot write `~/.claude/plugins/data/<plugin>-<marketplace>/` while sandboxed.

Add the marker after the shebang:

```ts
#!/usr/bin/env bun
// claude:dangerouslyDisableSandbox: hands off to osascript for JXA Apple Events
```

The marker goes on the top-level entrypoint script only. The hook inspects only the invoked script and never looks at imported modules. A helper like `things/scripts/ensure-running.ts` therefore doesn't carry a marker of its own. Its callers do.

The marker is inert on Linux and inert when the `mac` plugin is not installed. It only activates when this hook runs on macOS.

## Testing

```bash
bun test plugins/mac
```
