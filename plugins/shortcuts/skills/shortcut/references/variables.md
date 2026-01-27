# Variables

## Set Variable

Stores the current input or a value into a named variable:

```xml
<dict>
  <key>WFWorkflowActionIdentifier</key>
  <string>is.workflow.actions.setvariable</string>
  <key>WFWorkflowActionParameters</key>
  <dict>
    <key>WFVariableName</key>
    <string>MyVariable</string>
    <key>WFInput</key>
    <!-- variable reference or omit to use current input -->
  </dict>
</dict>
```

## Get Variable

Retrieves a named variable:

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

Any action can capture its output for later use. Add `UUID` and `CustomOutputName` to the action's parameters:

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

## Referencing Action Output

To use a captured output in a later action's parameters, use `WFTextTokenAttachment`:

```xml
<dict>
  <key>WFSerializationType</key>
  <string>WFTextTokenAttachment</string>
  <key>Value</key>
  <dict>
    <key>Type</key>
    <string>ActionOutput</string>
    <key>OutputUUID</key>
    <string>A1B2C3D4-E5F6-7890-ABCD-EF1234567890</string>
    <key>OutputName</key>
    <string>Greeting</string>
  </dict>
</dict>
```

The `OutputUUID` must match the `UUID` on the source action.

## Text with Embedded Variables

For strings that contain inline variable references, use `WFTextTokenString`. The variable position is marked by U+FFFC (Object Replacement Character):

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
        <string>A1B2C3D4-E5F6-7890-ABCD-EF1234567890</string>
        <key>OutputName</key>
        <string>Name</string>
      </dict>
    </dict>
  </dict>
</dict>
```

- `&#xFFFC;` marks where the variable is inserted in the string
- `{6, 1}` is `{offset, length}` — the character position of the replacement character
- Each embedded variable needs its own entry in `attachmentsByRange`

**Recommendation**: For simplicity, prefer `Set Variable` / `Get Variable` actions over inline token strings. Use `WFTextTokenString` only when you need variables embedded mid-string.
