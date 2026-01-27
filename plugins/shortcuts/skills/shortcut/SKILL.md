---
name: shortcut
description: Creating Apple Shortcuts programmatically as plist XML files, signing, importing, and running them. Use when the user wants to build, generate, or automate Apple Shortcuts without the GUI app.
allowed-tools: [Read, Write, Edit, Bash, Glob, Grep]
---

# Apple Shortcuts

Generate Apple Shortcuts as XML property list files. On macOS, discover available actions, sign, and import. On other platforms, produce the XML plist for the user to transfer.

## Phase 1: Discovery

Determine what's available before writing anything.

### Environment Detection

```bash
uname -s
```

- **Darwin**: macOS. Full pipeline: discover actions, generate, sign, import, run.
- **Linux** or other: No Shortcuts app or action metadata. Generate the XML plist only. Inform the user they'll need a Mac for signing and import.

On macOS, verify the CLI:

```bash
which shortcuts
```

### Built-in Actions (macOS)

The authoritative list of built-in actions lives in:

```
/System/Library/PrivateFrameworks/WorkflowKit.framework/WFActions.plist
```

Convert and read it to discover action identifiers and their parameter definitions:

```bash
plutil -convert xml1 -o /tmp/WFActions.xml /System/Library/PrivateFrameworks/WorkflowKit.framework/WFActions.plist
```

Each key in the plist is an action identifier (e.g. `is.workflow.actions.alert`). The value is a dict with parameter definitions, input/output types, and metadata.

### Third-Party App Actions (macOS)

Apps expose Shortcuts actions via the App Intents framework. The system indexes metadata from app bundles at install time. There is no CLI to enumerate third-party actions directly. To discover an app's actions:

1. **Inspect the app bundle** for `Metadata.appintents`:
   ```bash
   find /Applications/MyApp.app -name "Metadata.appintents" -type d
   ```
2. **Export an existing shortcut** that uses the app's actions and examine the plist:
   ```bash
   shortcuts export "My Shortcut" -o /tmp/examine.shortcut
   plutil -convert xml1 /tmp/examine.shortcut
   ```
3. **Search for the app's bundle ID** in existing shortcut databases:
   ```bash
   sqlite3 ~/Library/Shortcuts/Shortcuts.sqlite \
     "SELECT ZDATA FROM ZSHORTCUTACTIONS" | strings | grep -i "com.example.app"
   ```

### Existing Shortcuts

List what's already installed:

```bash
shortcuts list
shortcuts list -f "Folder Name"
shortcuts list --folders
```

### Non-macOS Discovery

Without macOS, rely on:
- The [references/actions.md](references/actions.md) file for common built-in actions
- The [references/format.md](references/format.md) file for plist structure
- The user's description of what the shortcut should do

## Phase 2: Generation

Write the shortcut as an XML plist file. See [references/format.md](references/format.md) for the complete structure and [references/actions.md](references/actions.md) for common action identifiers.

### Minimal Template

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

### Key Conventions

- **UUIDs**: Control flow (if/else, repeat, menus) and variable references use UUIDs. Generate valid v4 UUIDs for each linkage.
- **Variables**: Prefer `Set Variable` / `Get Variable` actions over inline `WFTextTokenString` with `attachmentsByRange` for simplicity.
- **Action output**: Add a `UUID` and `CustomOutputName` key to an action's parameters to capture its output for later reference.

## Phase 3: Deployment (macOS only)

### Convert, Sign, Import

```bash
# Convert XML to binary plist
plutil -convert binary1 -o "MyShortcut.shortcut" "MyShortcut.plist"

# Sign (required for iOS 15+ import)
shortcuts sign -i "MyShortcut.shortcut" -o "MyShortcut-signed.shortcut"

# Import into Shortcuts app
shortcuts import "MyShortcut-signed.shortcut"
```

### Run

```bash
shortcuts run "MyShortcut"
shortcuts run "MyShortcut" -i input.txt       # with input file
shortcuts run "MyShortcut" -o output.txt      # capture output
```

### Iterate

To update an imported shortcut:

```bash
shortcuts delete "MyShortcut"
shortcuts import "MyShortcut-signed.shortcut"
```

## Constraints

- **Signing requires macOS Monterey+**. No way to sign on Linux.
- **iOS 15+ requires signed `.shortcut` files** for import.
- **No public action spec**. Built-in actions change with each OS release. Always use discovery when on macOS.

## References

- **[references/format.md](references/format.md)**: Plist structure, parameter types, variable references, control flow
- **[references/actions.md](references/actions.md)**: Common built-in action identifiers (scripting, text, web, files, etc.)
