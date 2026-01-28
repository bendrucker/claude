# Plist Structure

A `.shortcut` file is a binary property list (bplist). For programmatic creation, write as XML plist and convert with `plutil -convert binary1`.

## Top-Level Keys

| Key | Type | Description |
|-----|------|-------------|
| `WFWorkflowClientVersion` | string | Client version (e.g. `"2702"`) |
| `WFWorkflowMinimumClientVersion` | integer | Minimum app version to run |
| `WFWorkflowMinimumClientVersionString` | string | Same as above, as string (e.g. `"900"`) |
| `WFWorkflowName` | string | Shortcut display name (optional, set on import) |
| `WFWorkflowIcon` | dict | Icon appearance |
| `WFWorkflowTypes` | array of string | Where the shortcut appears |
| `WFWorkflowInputContentItemClasses` | array of string | Accepted input types |
| `WFWorkflowImportQuestions` | array of dict | Prompts shown during import |
| `WFWorkflowActions` | array of dict | The actions (core content) |

## WFWorkflowIcon

```xml
<key>WFWorkflowIcon</key>
<dict>
  <key>WFWorkflowIconStartColor</key>
  <integer>4282601983</integer>
  <key>WFWorkflowIconGlyphNumber</key>
  <integer>59511</integer>
</dict>
```

Colors are RGBA-8 integers:

| Color | Value |
|-------|-------|
| Red | 4282601983 |
| Orange | 4251333119 |
| Yellow | 4260881663 |
| Green | 4292093695 |
| Blue | 463140863 |
| Purple | 2071128575 |
| Gray | 3679049983 |

## WFWorkflowTypes

Controls where the shortcut appears:

| Value | Context |
|-------|---------|
| `MenuBar` | Shortcuts menu bar |
| `QuickActions` | Finder/Files quick actions |
| `ActionExtension` | Share Sheet |
| `NCWidget` | Notification Center widget |
| `Sleep` | Sleep Mode (iOS/iPadOS) |
| `Watch` | Apple Watch |
| `ReceivesOnScreenContent` | Receives on-screen content |

## WFWorkflowInputContentItemClasses

Accepted input types when the shortcut receives input from the share sheet or another shortcut:

- `WFAppStoreAppContentItem`
- `WFArticleContentItem`
- `WFContactContentItem`
- `WFDateContentItem`
- `WFEmailAddressContentItem`
- `WFFileContentItem`
- `WFGenericFileContentItem`
- `WFImageContentItem`
- `WFLocationContentItem`
- `WFMapContentItem`
- `WFPDFContentItem`
- `WFPhoneNumberContentItem`
- `WFRichTextContentItem`
- `WFSafariWebPageContentItem`
- `WFStringContentItem`
- `WFURLContentItem`

## Action Structure

Each action in `WFWorkflowActions` is a dict with two keys:

```xml
<dict>
  <key>WFWorkflowActionIdentifier</key>
  <string>is.workflow.actions.alert</string>
  <key>WFWorkflowActionParameters</key>
  <dict>
    <key>WFAlertActionMessage</key>
    <string>Hello World</string>
  </dict>
</dict>
```

- `WFWorkflowActionIdentifier`: Reverse domain notation. Built-in: `is.workflow.actions.*`. Third-party: `com.company.app.*`.
- `WFWorkflowActionParameters`: Dict of key-value pairs specific to the action.
