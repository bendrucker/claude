---
name: mac:jxa-run
description: Execute JXA scripts scoped to a macOS application. Use when running JXA expressions or script files against an app via osascript. Validates Application() scope via AST.
context: fork
allowed-tools:
  - "Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/jxa.ts:*)"
---

# Run JXA

Run the JXA expression or script file provided in the arguments. `$0` is the app name, remaining arguments are passed to the runner.

```bash
bun ${CLAUDE_PLUGIN_ROOT}/scripts/jxa.ts $ARGUMENTS
```

Return the output to the caller.
