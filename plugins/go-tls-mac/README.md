# Go TLS Mac

Disable sandbox for Go binaries on macOS to fix TLS certificate verification.

## Contents

- **Hook: sandbox** — PreToolUse hook that detects Go binaries and disables the sandbox

## Background

Go binaries use Security.framework (via cgo) for TLS certificate verification on macOS, which requires mach IPC to `com.apple.trustd.agent`. Claude Code's Seatbelt sandbox blocks this IPC, causing `x509: OSStatus -26276` errors for any Go binary (`gh`, `terraform`, `kubectl`, `glab`, etc.).

This plugin installs a PreToolUse hook that inspects Bash commands for Go binaries by checking for the `__go_buildinfo` marker in the executable. When detected, it injects `dangerouslyDisableSandbox: true` to bypass the sandbox.

## Testing

```bash
bun test plugins/go-tls-mac
```
