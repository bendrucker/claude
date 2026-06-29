# Mac

macOS-specific automation and system integration.

## Contents

### Skills

- **jxa** — JXA language guide for writing JavaScript for Automation code
- **jxa-run** — App-scoped JXA runner with AST-based Application() validation

### Scripts

- `scripts/jxa.ts` — App-scoped JXA runner with AST-based `Application()` validation
- `scripts/open-url.ts` — Scheme-scoped URL opener with scheme validation

## Sandbox

Go-based CLIs and Launch Services handoffs run sandboxed. Two `sandbox` keys in `user/settings.json` cover them profile-wide:

- `sandbox.network.allowMachLookup: ["com.apple.trustd.agent"]` lets Go's `crypto/x509` reach the system `trustd` daemon for TLS verification (`gh`, `glab`, `terraform`, `kubectl`, `go`).
- `sandbox.allowAppleEvents: true` covers Apple Events and Launch Services `open`/URL-scheme handoff (`open-url.ts`, the Things scripts).

## Testing

```bash
bun test plugins/mac
```
