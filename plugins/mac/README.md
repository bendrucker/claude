# Mac

macOS-specific automation, sandbox workarounds, and system integration.

## Contents

### Skills

- **jxa** — JXA language guide for writing JavaScript for Automation code
- **jxa-run** — App-scoped JXA runner with AST-based Application() validation

### Hooks

- **sandbox** — Detects Go binaries and disables sandbox for TLS cert verification

### Scripts

- `scripts/jxa.ts` — App-scoped JXA runner with AST-based `Application()` validation
- `scripts/open-url.ts` — Scheme-scoped URL opener with scheme validation

## Testing

```bash
bun test plugins/mac
```
