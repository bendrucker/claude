# Mac

macOS-specific automation, sandbox workarounds, and system integration.

## Contents

- **Hook: sandbox** — Detects Go binaries and disables sandbox for TLS cert verification
- **Settings** — Sandbox exclusions for macOS system commands (`osascript`, `security`, `open`, etc.)

### Scripts

- `scripts/jxa.ts` — App-scoped JXA runner with AST-based `Application()` validation
- `scripts/open-url.ts` — Scheme-scoped URL opener with scheme validation

## Testing

```bash
bun test plugins/mac
```
