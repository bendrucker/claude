# Mac

macOS-specific automation and system integration.

## Contents

### Skills

- The **jxa** skill is a JXA language guide for writing JavaScript for Automation code.
- The **jxa-run** skill is an app-scoped JXA runner with AST-based Application() validation.

### Hooks

- The `sandbox-ssh-proxy` hook runs at `SessionStart` and lets sandboxed git reach SSH remotes on macOS ([details](hooks/sandbox-ssh-proxy.md)).

### Scripts

- `scripts/jxa.ts` is an app-scoped JXA runner with AST-based `Application()` validation.
- `scripts/open-url.ts` is a scheme-scoped URL opener with scheme validation.

## Sandbox

Go-based CLIs run fine sandboxed: `sandbox.network.allowMachLookup: ["com.apple.trustd.agent"]` in `user/settings.json` lets Go's `crypto/x509` reach the system `trustd` daemon for TLS verification (`gh`, `glab`, `terraform`, `kubectl`, `go`) profile-wide.

Apple Events and Launch Services handoff is different. Scripts that shell out to `osascript` (JXA) or `open` (URL schemes) do not survive the sandbox even with `sandbox.allowAppleEvents`. They need a full skip, which a `sandbox.excludedCommands` entry naming the script's deployed path gives: `bun /Users/<user>/.claude-repo/plugins/mac/scripts/jxa.ts:*`. The entry matches command text, so the script escapes only when it is the whole command.

## Testing

```bash
bun test plugins/mac
```
