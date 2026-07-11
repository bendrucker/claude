# Mac

macOS-specific automation and system integration.

## Contents

### Skills

- **jxa** — JXA language guide for writing JavaScript for Automation code
- **jxa-run** — App-scoped JXA runner with AST-based Application() validation

### Hooks

- **sandbox** — Reads the invoked `bun`/`node` script for the `claude:dangerouslyDisableSandbox` marker and disables the command sandbox when present. Matches both `Bash` and `Monitor` tool calls.

### Scripts

- `scripts/jxa.ts` — App-scoped JXA runner with AST-based `Application()` validation
- `scripts/open-url.ts` — Scheme-scoped URL opener with scheme validation

## Sandbox

Go-based CLIs run fine sandboxed: `sandbox.network.allowMachLookup: ["com.apple.trustd.agent"]` in `user/settings.json` lets Go's `crypto/x509` reach the system `trustd` daemon for TLS verification (`gh`, `glab`, `terraform`, `kubectl`, `go`) profile-wide.

Apple Events and Launch Services handoff is different. Scripts that shell out to `osascript` (JXA) or `open` (URL schemes) do not survive the sandbox even with `sandbox.allowAppleEvents`, so they need a full skip.

### Sandbox bypass marker

The `sandbox` hook disables the command sandbox for a `bun <script>` or `node <script>` invocation when the script's first 64KB contains the literal string `claude:dangerouslyDisableSandbox`. Add the marker after the shebang of any top-level wrapper that hands off to Apple Events or Launch Services:

```ts
#!/usr/bin/env bun
// claude:dangerouslyDisableSandbox: hands off to osascript for JXA Apple Events
```

The marker goes on the top-level entrypoint script only. The hook inspects the `bun`/`node` script argument, not imported modules, so a helper like `things/scripts/ensure-running.ts` carries no marker of its own; its callers do.

The marker is inert on Linux and inert when the `mac` plugin is not installed. It only activates when this hook runs on macOS.

## Testing

```bash
bun test plugins/mac
```
