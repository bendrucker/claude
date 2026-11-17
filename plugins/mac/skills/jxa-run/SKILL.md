---
name: mac:jxa-run
description: Execute JXA scripts scoped to a macOS application. Use when running JXA expressions or script files against an app via osascript. Validates Application() scope via AST.
argument-hint: <app> <expression-or-script-file>
effort: low
allowed-tools:
  - "Bash(jxa-run:*)"
---

# Run JXA

Run the JXA expression or script file from the arguments. `$0` is the app name. Runner flags (`-e`) go before the script path. Every argument after the script path passes to the script unchanged, its own flags included.

```bash
jxa-run $ARGUMENTS
```

Run it as the whole Bash command. The runner leaves the sandbox through a `sandbox.excludedCommands` entry, which matches only when nothing precedes, follows, or pipes from it.
