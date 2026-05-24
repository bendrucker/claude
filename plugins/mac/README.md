# Mac

macOS-specific automation, sandbox workarounds, and system integration.

## Contents

### Skills

- **jxa** — JXA language guide for writing JavaScript for Automation code
- **jxa-run** — App-scoped JXA runner with AST-based Application() validation

### Hooks

- **sandbox** — Detects Go binaries and disables sandbox for TLS cert verification. Matches both `Bash` and `Monitor` tool calls.

### Scripts

- `scripts/jxa.ts` — App-scoped JXA runner with AST-based `Application()` validation
- `scripts/open-url.ts` — Scheme-scoped URL opener with scheme validation

## Sandbox bypass marker

The sandbox hook auto-disables Seatbelt for two cases:

1. The invoked executable is a Go binary (detected by the `__go_buildinfo` byte marker in the first 64KB of the binary).
2. A `bun <script>` or `node <script>` invocation, where the script's first 64KB contains the literal string `claude:dangerouslyDisableSandbox`.

The second mechanism is opt-in. Plugins that ship a wrapper script which shells out to Go binaries (`gh`, `glab`, `terraform`, etc.) can add a comment near the top of the script:

```ts
#!/usr/bin/env bun
// claude:dangerouslyDisableSandbox: shells out to gh for TLS-bearing API calls
```

The marker is inert on Linux and inert when the `mac` plugin is not installed. It only activates when this hook is running on macOS.

## Testing

```bash
bun test plugins/mac
```
