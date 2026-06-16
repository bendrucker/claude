# Parameter Types

Action parameters in `WFWorkflowActionParameters` use several value encodings.

## Literal Values

Simple strings, integers, booleans, and arrays use standard plist types:

```xml
<key>WFParamName</key>
<string>text value</string>

<key>WFParamName</key>
<integer>42</integer>

<key>WFParamName</key>
<true/>

<key>WFParamName</key>
<array>
  <string>item1</string>
  <string>item2</string>
</array>
```

## Enum Values

Parameters with fixed options are encoded as plain strings:

```xml
<key>WFHTTPMethod</key>
<string>GET</string>

<key>WFCaseType</key>
<string>UPPERCASE</string>
```

## Dictionary Field Values

Complex values use `WFSerializationType` with a `Value` dict containing `WFItemType`:

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

### WFItemType Codes

| Code | Type |
|------|------|
| 0 | Text |
| 1 | Dictionary |
| 2 | Array |
| 3 | Number |
| 4 | Boolean |

## Serialization Types

The `WFSerializationType` key signals that a value uses a structured encoding:

| Type | Purpose |
|------|---------|
| `WFDictionaryFieldValue` | Typed dictionary field (with `WFItemType`) |
| `WFTextTokenAttachment` | Variable reference (action output or named variable) |
| `WFTextTokenString` | Text with embedded variable references |
| `WFNumberSubstitutableState` | Number that may contain a variable |

## Variable-Containing Parameters

When a parameter that normally takes a literal value needs to reference a variable, wrap it in the appropriate serialization type. See [variables.md](variables.md) for `WFTextTokenAttachment` and `WFTextTokenString` details.
