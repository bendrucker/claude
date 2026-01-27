# Shortcut File Format

A `.shortcut` file is a binary property list (bplist). For programmatic creation, write as XML plist and convert with `plutil -convert binary1`.

## Top-Level Keys

| Key | Type | Description |
|-----|------|-------------|
| `WFWorkflowClientVersion` | string | Client version (e.g. `"2702"`) |
| `WFWorkflowMinimumClientVersion` | integer | Minimum app version to run |
| `WFWorkflowMinimumClientVersionString` | string | Same as above, as string (e.g. `"900"`) |
| `WFWorkflowName` | string | Shortcut display name (optional in file, set on import) |
| `WFWorkflowIcon` | dict | Icon appearance |
| `WFWorkflowTypes` | array of string | Where the shortcut appears |
| `WFWorkflowInputContentItemClasses` | array of string | Accepted input types |
| `WFWorkflowImportQuestions` | array of dict | Prompts shown during import |
| `WFWorkflowActions` | array of dict | The actions (the core content) |

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

Colors are RGBA-8 integers. Common values:

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

- `MenuBar` - Shortcuts menu bar
- `QuickActions` - Finder/Files quick actions
- `ActionExtension` - Share Sheet
- `NCWidget` - Notification Center widget
- `Sleep` - Sleep Mode (iOS/iPadOS)
- `Watch` - Apple Watch
- `ReceivesOnScreenContent` - Receives on-screen content

## WFWorkflowInputContentItemClasses

Accepted input types (reverse domain notation):

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

- `WFWorkflowActionIdentifier`: Reverse domain notation identifying the action. Built-in actions use `is.workflow.actions.*`. Third-party app actions use `com.company.app.*`.
- `WFWorkflowActionParameters`: Dict of key-value pairs specific to the action. Keys and accepted values vary per action.

## Parameter Value Types

### Literal Values

Simple strings, integers, booleans, and arrays use standard plist types:

```xml
<key>WFParamName</key>
<string>text value</string>

<key>WFParamName</key>
<integer>42</integer>

<key>WFParamName</key>
<true/>
```

### Enum Values

Many parameters accept a fixed set of values. These are encoded as plain strings or integers:

```xml
<key>WFHTTPMethod</key>
<string>GET</string>
```

### Dictionary Values

Complex values use `WFSerializationType` and `WFItemType`:

```xml
<dict>
  <key>WFSerializationType</key>
  <string>WFDictionaryFieldValue</string>
  <key>Value</key>
  <dict>
    <key>WFItemType</key>
    <integer>0</integer>
    <key>Value</key>
    <string>text content</string>
  </dict>
</dict>
```

`WFItemType` codes: 0 = text, 1 = dictionary, 2 = array, 3 = number, 4 = boolean.

### Variable References

To reference the output of a previous action:

```xml
<dict>
  <key>WFSerializationType</key>
  <string>WFTextTokenAttachment</string>
  <key>Value</key>
  <dict>
    <key>Type</key>
    <string>ActionOutput</string>
    <key>OutputUUID</key>
    <string>XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX</string>
    <key>OutputName</key>
    <string>Variable Name</string>
  </dict>
</dict>
```

The `OutputUUID` matches the `UUID` key set on the source action's parameters.

### Text with Embedded Variables

For strings containing inline variable references, use `WFTextTokenString`:

```xml
<dict>
  <key>WFSerializationType</key>
  <string>WFTextTokenString</string>
  <key>Value</key>
  <dict>
    <key>string</key>
    <string>Hello &#xFFFC; how are you?</string>
    <key>attachmentsByRange</key>
    <dict>
      <key>{6, 1}</key>
      <dict>
        <key>Type</key>
        <string>ActionOutput</string>
        <key>OutputUUID</key>
        <string>XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX</string>
        <key>OutputName</key>
        <string>Name</string>
      </dict>
    </dict>
  </dict>
</dict>
```

The `&#xFFFC;` (U+FFFC Object Replacement Character) marks where the variable is inserted. The `{6, 1}` key is `{offset, length}` in the string.

## Control Flow

### If/Otherwise/End If

Three linked actions sharing a `GroupingIdentifier` UUID:

```xml
<!-- If -->
<dict>
  <key>WFWorkflowActionIdentifier</key>
  <string>is.workflow.actions.conditional</string>
  <key>WFWorkflowActionParameters</key>
  <dict>
    <key>GroupingIdentifier</key>
    <string>GROUP-UUID-HERE</string>
    <key>WFControlFlowMode</key>
    <integer>0</integer>
    <key>WFCondition</key>
    <integer>4</integer>
    <key>WFInput</key>
    <!-- variable reference to test -->
  </dict>
</dict>

<!-- Otherwise -->
<dict>
  <key>WFWorkflowActionIdentifier</key>
  <string>is.workflow.actions.conditional</string>
  <key>WFWorkflowActionParameters</key>
  <dict>
    <key>GroupingIdentifier</key>
    <string>GROUP-UUID-HERE</string>
    <key>WFControlFlowMode</key>
    <integer>1</integer>
  </dict>
</dict>

<!-- End If -->
<dict>
  <key>WFWorkflowActionIdentifier</key>
  <string>is.workflow.actions.conditional</string>
  <key>WFWorkflowActionParameters</key>
  <dict>
    <key>GroupingIdentifier</key>
    <string>GROUP-UUID-HERE</string>
    <key>WFControlFlowMode</key>
    <integer>2</integer>
  </dict>
</dict>
```

`WFControlFlowMode`: 0 = start (if), 1 = middle (otherwise), 2 = end.

`WFCondition` values: 0 = equals, 1 = not equals, 2 = greater than, 3 = less than, 4 = contains, 5 = does not contain, 100 = is, 101 = is not, 999 = has any value.

### Repeat

```xml
<!-- Repeat Start -->
<dict>
  <key>WFWorkflowActionIdentifier</key>
  <string>is.workflow.actions.repeat.count</string>
  <key>WFWorkflowActionParameters</key>
  <dict>
    <key>GroupingIdentifier</key>
    <string>GROUP-UUID-HERE</string>
    <key>WFControlFlowMode</key>
    <integer>0</integer>
    <key>WFRepeatCount</key>
    <integer>5</integer>
  </dict>
</dict>

<!-- Repeat End -->
<dict>
  <key>WFWorkflowActionIdentifier</key>
  <string>is.workflow.actions.repeat.count</string>
  <key>WFWorkflowActionParameters</key>
  <dict>
    <key>GroupingIdentifier</key>
    <string>GROUP-UUID-HERE</string>
    <key>WFControlFlowMode</key>
    <integer>2</integer>
  </dict>
</dict>
```

### Repeat with Each

```xml
<!-- Repeat with Each Start -->
<dict>
  <key>WFWorkflowActionIdentifier</key>
  <string>is.workflow.actions.repeat.each</string>
  <key>WFWorkflowActionParameters</key>
  <dict>
    <key>GroupingIdentifier</key>
    <string>GROUP-UUID-HERE</string>
    <key>WFControlFlowMode</key>
    <integer>0</integer>
    <key>WFInput</key>
    <!-- variable reference to collection -->
  </dict>
</dict>

<!-- Repeat with Each End -->
<dict>
  <key>WFWorkflowActionIdentifier</key>
  <string>is.workflow.actions.repeat.each</string>
  <key>WFWorkflowActionParameters</key>
  <dict>
    <key>GroupingIdentifier</key>
    <string>GROUP-UUID-HERE</string>
    <key>WFControlFlowMode</key>
    <integer>2</integer>
  </dict>
</dict>
```

### Choose from Menu

```xml
<!-- Menu Start -->
<dict>
  <key>WFWorkflowActionIdentifier</key>
  <string>is.workflow.actions.choosefrommenu</string>
  <key>WFWorkflowActionParameters</key>
  <dict>
    <key>GroupingIdentifier</key>
    <string>GROUP-UUID-HERE</string>
    <key>WFControlFlowMode</key>
    <integer>0</integer>
    <key>WFMenuPrompt</key>
    <string>Choose an option</string>
    <key>WFMenuItems</key>
    <array>
      <string>Option A</string>
      <string>Option B</string>
    </array>
  </dict>
</dict>

<!-- Menu Item: Option A -->
<dict>
  <key>WFWorkflowActionIdentifier</key>
  <string>is.workflow.actions.choosefrommenu</string>
  <key>WFWorkflowActionParameters</key>
  <dict>
    <key>GroupingIdentifier</key>
    <string>GROUP-UUID-HERE</string>
    <key>WFControlFlowMode</key>
    <integer>1</integer>
    <key>WFMenuItemTitle</key>
    <string>Option A</string>
  </dict>
</dict>

<!-- (actions for Option A go here) -->

<!-- Menu Item: Option B -->
<dict>
  <key>WFWorkflowActionIdentifier</key>
  <string>is.workflow.actions.choosefrommenu</string>
  <key>WFWorkflowActionParameters</key>
  <dict>
    <key>GroupingIdentifier</key>
    <string>GROUP-UUID-HERE</string>
    <key>WFControlFlowMode</key>
    <integer>1</integer>
    <key>WFMenuItemTitle</key>
    <string>Option B</string>
  </dict>
</dict>

<!-- (actions for Option B go here) -->

<!-- Menu End -->
<dict>
  <key>WFWorkflowActionIdentifier</key>
  <string>is.workflow.actions.choosefrommenu</string>
  <key>WFWorkflowActionParameters</key>
  <dict>
    <key>GroupingIdentifier</key>
    <string>GROUP-UUID-HERE</string>
    <key>WFControlFlowMode</key>
    <integer>2</integer>
  </dict>
</dict>
```

## Named Variables

### Set Variable

```xml
<dict>
  <key>WFWorkflowActionIdentifier</key>
  <string>is.workflow.actions.setvariable</string>
  <key>WFWorkflowActionParameters</key>
  <dict>
    <key>WFVariableName</key>
    <string>MyVariable</string>
    <key>WFInput</key>
    <!-- variable reference or value -->
  </dict>
</dict>
```

### Get Variable

```xml
<dict>
  <key>WFWorkflowActionIdentifier</key>
  <string>is.workflow.actions.getvariable</string>
  <key>WFWorkflowActionParameters</key>
  <dict>
    <key>WFVariable</key>
    <dict>
      <key>WFSerializationType</key>
      <string>WFTextTokenAttachment</string>
      <key>Value</key>
      <dict>
        <key>Type</key>
        <string>Variable</string>
        <key>VariableName</key>
        <string>MyVariable</string>
      </dict>
    </dict>
  </dict>
</dict>
```

## Action Output UUIDs

To capture an action's output for later use, add a `UUID` key to its parameters:

```xml
<dict>
  <key>WFWorkflowActionIdentifier</key>
  <string>is.workflow.actions.gettext</string>
  <key>WFWorkflowActionParameters</key>
  <dict>
    <key>WFTextActionText</key>
    <string>Hello World</string>
    <key>UUID</key>
    <string>A1B2C3D4-E5F6-7890-ABCD-EF1234567890</string>
    <key>CustomOutputName</key>
    <string>Greeting</string>
  </dict>
</dict>
```

Later actions reference this output via `OutputUUID` matching the `UUID` above.
