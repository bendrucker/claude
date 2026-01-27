# Action Discovery

The `discover.swift` CLI enumerates available Shortcuts actions on macOS. It reads `WFActions.plist` from Apple's private `WorkflowKit.framework` and scans installed apps for App Intents metadata.

**macOS only.** On Linux, this script is unavailable — use the static [actions.md](actions.md) reference instead.

## Commands

All commands output JSON and run via the Swift interpreter:

```bash
swift @scripts/discover.swift <command> [options]
```

### List all actions

```bash
swift @scripts/discover.swift list
```

Returns every built-in action identifier with its description and category. Use `--category` to filter:

```bash
swift @scripts/discover.swift list --category Scripting
```

### Describe a specific action

```bash
swift @scripts/discover.swift describe is.workflow.actions.downloadurl
```

Returns full details: description, input/output types, parameters with keys, labels, types, and defaults.

### Search actions

```bash
swift @scripts/discover.swift search "calendar"
swift @scripts/discover.swift search "http"
swift @scripts/discover.swift search "clipboard"
```

Searches action identifiers, descriptions, keywords, and categories. Returns matching actions.

### List categories

```bash
swift @scripts/discover.swift categories
```

Returns all action categories with counts. Useful for browsing what's available.

### List apps with Shortcuts actions

```bash
swift @scripts/discover.swift apps
```

Scans `/Applications`, `/System/Applications`, and `/System/Applications/Utilities` for apps that provide Shortcuts actions via App Intents or legacy SiriKit. Returns app name, path, and bundle ID.

## Typical Workflow

1. **Search** for actions related to the user's goal:
   ```bash
   swift @scripts/discover.swift search "notification"
   ```

2. **Describe** a promising action to see its parameters:
   ```bash
   swift @scripts/discover.swift describe is.workflow.actions.notification
   ```

3. **Use the parameter details** to write the action's XML plist entry.

## Third-Party App Actions

The `apps` command finds which apps have Shortcuts support, but cannot enumerate their individual actions. For a specific third-party app, the best approach is to export an existing shortcut that uses the app:

```bash
shortcuts export "My Shortcut" -o /tmp/examine.shortcut
plutil -convert xml1 /tmp/examine.shortcut
```

Then read the XML to find the action identifiers (e.g. `com.culturedcode.ThingsMac.add-task`) and their parameter keys.

## Data Source

The CLI reads from:

```
/System/Library/PrivateFrameworks/WorkflowKit.framework/WFActions.plist
```

This is Apple's private framework. The contents change with macOS releases as actions are added or modified. The discovery CLI always reflects the current system's available actions.
