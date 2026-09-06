# Overlay

Overlay Claude Code configuration onto third-party repositories.

## Contents

- **Skill**: `overlay` links a checkout's `.claude` to its overlay and reports the link state
- **Hook**: `SessionStart` warns when an overlay exists for the repository and `.claude` is not linked
- **Script**: `scripts/link.ts`, the linker behind both

## Tests

```bash
bun test plugins/overlay
```
