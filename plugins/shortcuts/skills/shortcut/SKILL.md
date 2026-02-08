---
name: shortcuts:shortcut
description: Creating Apple Shortcuts programmatically as plist XML files. Use when the user wants to build, generate, or author Apple Shortcuts without the GUI app.
allowed-tools: [Read, Write, Edit, "Bash(swift ${CLAUDE_SKILL_ROOT}/scripts/discover.swift:*)", Bash(plutil:*), Bash(shortcuts:*), Bash(open:*), Bash(jq:*), Bash(uname:*), Bash(which:*), Glob, Grep]
hooks:
  PreToolUse:
    - matcher: "Bash(swift ${CLAUDE_SKILL_ROOT}/scripts/discover.swift:*)|Bash(shortcuts:*)"
      hooks:
        - type: command
          command: |
            cat | jq '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput: {dangerouslyDisableSandbox: true}}}'
---

# Apple Shortcuts

Generate Apple Shortcuts as XML property list files.

## Environment

- **OS**: !`uname -s`
- **shortcuts CLI**: !`which shortcuts 2>/dev/null && echo "available" || echo "not available"`

If the OS is **Darwin** (macOS), use the discovery CLI and the full deployment pipeline (convert, sign, import, run). If **Linux**, generate XML only — signing and import are unavailable. Inform the user.

## Discovery

**On macOS**, use the discovery CLI to find actions: see [references/discovery.md](references/discovery.md)

**On any platform**, use the static action catalog: see [references/actions.md](references/actions.md)

## Generation

Write the shortcut as an XML plist. Load references as needed:

- **Starting a shortcut?** See [references/plist-structure.md](references/plist-structure.md) for top-level keys, icon, types
- **Writing control flow?** See [references/control-flow.md](references/control-flow.md) for if/else, repeat, menu XML
- **Passing data between actions?** See [references/variables.md](references/variables.md) for set/get, output UUIDs
- **Complex parameter values?** See [references/parameters.md](references/parameters.md) for serialization types

Minimal template:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>WFWorkflowMinimumClientVersionString</key>
  <string>900</string>
  <key>WFWorkflowMinimumClientVersion</key>
  <integer>900</integer>
  <key>WFWorkflowClientVersion</key>
  <string>2702</string>
  <key>WFWorkflowIcon</key>
  <dict>
    <key>WFWorkflowIconStartColor</key>
    <integer>463140863</integer>
    <key>WFWorkflowIconGlyphNumber</key>
    <integer>59511</integer>
  </dict>
  <key>WFWorkflowTypes</key>
  <array>
    <string>MenuBar</string>
  </array>
  <key>WFWorkflowInputContentItemClasses</key>
  <array/>
  <key>WFWorkflowActions</key>
  <array>
    <!-- actions go here -->
  </array>
</dict>
</plist>
```

Key conventions:

- **UUIDs**: Control flow and variable references use v4 UUIDs. Generate a fresh one for each linkage.
- **Variables**: Prefer `Set Variable` / `Get Variable` over inline `WFTextTokenString`.
- **Action output**: Add `UUID` and `CustomOutputName` to an action's parameters to capture its output.

## Deployment (macOS only)

See [references/deployment.md](references/deployment.md) for the full pipeline: convert, sign, import, iterate.

Quick reference:

```bash
plutil -convert binary1 -o "My Shortcut.shortcut" "My Shortcut.plist"
mkdir -p out
shortcuts sign -i "My Shortcut.shortcut" -o "out/My Shortcut.shortcut"
open "out/My Shortcut.shortcut"
```

## Constraints

- Signing requires macOS. No way to sign on Linux.
- Shortcuts must be signed before import.
- No public action spec. Use discovery on macOS; use static references elsewhere.

## References

- **[references/discovery.md](references/discovery.md)** — Swift CLI for enumerating actions, app inspection
- **[references/actions.md](references/actions.md)** — Static catalog of common built-in actions
- **[references/plist-structure.md](references/plist-structure.md)** — Top-level keys, icon colors, workflow types
- **[references/control-flow.md](references/control-flow.md)** — If/else, repeat, menu with full XML examples
- **[references/variables.md](references/variables.md)** — Set/Get variable, output UUIDs, token strings
- **[references/parameters.md](references/parameters.md)** — Value types, serialization, dictionary encoding
- **[references/deployment.md](references/deployment.md)** — plutil, shortcuts sign, import via open, iteration
