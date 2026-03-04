# Mac

macOS-specific automation, sandbox workarounds, and system integration.

## Contents

- **Hook: sandbox** — Detects Go binaries and disables sandbox for TLS cert verification
- **Settings** — Sandbox exclusions for macOS system commands (`osascript`, `security`, `open`, etc.)

## Testing

```bash
bun test plugins/mac
```
