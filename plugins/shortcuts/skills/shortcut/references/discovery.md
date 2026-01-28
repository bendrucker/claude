# Action Discovery

The `discover.swift` CLI provides access to macOS-native Shortcuts APIs, outputting JSON arrays for composition with `jq`.

**macOS only.** On Linux, use the static [actions.md](actions.md) reference instead.

## Commands

```bash
swift @scripts/discover.swift <actions|apps>
```

### `actions` — Dump all built-in actions

Outputs a JSON array of all built-in Shortcuts actions with identifier, name, description, category, and parameters. Takes ~3s due to runtime introspection of 387+ actions.

```bash
swift @scripts/discover.swift actions
```

**Cache on first use.** The output is stable within a session. Write it to a temp file and query from there:

```bash
swift @scripts/discover.swift actions > /tmp/shortcut-actions.json

# Search by identifier
jq '[.[] | select(.identifier | test("calendar"))]' /tmp/shortcut-actions.json

# Search by name or description (case-insensitive)
jq '[.[] | select(.name | test("notification"; "i"))]' /tmp/shortcut-actions.json

# Filter by category
jq '[.[] | select(.category == "Scripting")]' /tmp/shortcut-actions.json

# Get details for a specific action
jq '.[] | select(.identifier == "is.workflow.actions.downloadurl")' /tmp/shortcut-actions.json

# List unique categories
jq '[.[].category // empty] | unique' /tmp/shortcut-actions.json

# List just identifiers
jq '.[].identifier' /tmp/shortcut-actions.json
```

### `apps` — List apps with Shortcuts support

Outputs a JSON array of installed apps that provide App Intents metadata.

```bash
swift @scripts/discover.swift apps
```

```bash
# Find a specific app
swift @scripts/discover.swift apps | jq '.[] | select(.name | test("Things"; "i"))'
```

## Third-Party App Actions

The `apps` command finds which apps have Shortcuts support but cannot enumerate their individual actions. To discover a third-party app's actions, create a shortcut using that app in the GUI, then inspect it:

```bash
# Open a shortcut in the editor to examine its structure
shortcuts view "My Shortcut"
```

## Data Source

The CLI uses the WorkflowKit framework's runtime API (`WFActionRegistry`) to enumerate actions. This reflects the current system's available actions regardless of macOS version.
