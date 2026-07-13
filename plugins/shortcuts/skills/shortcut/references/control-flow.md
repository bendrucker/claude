# Control Flow

All control flow actions use two shared keys:

- `GroupingIdentifier`: A UUID shared across the start/middle/end actions of a block
- `WFControlFlowMode`: `0` = start, `1` = middle (otherwise/menu item), `2` = end

Generate a fresh UUID for each control flow block.

## If / Otherwise / End If

Three actions sharing a `GroupingIdentifier`.

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

`WFCondition` values:

| Value | Meaning |
|-------|---------|
| 0 | Equals |
| 1 | Not equals |
| 2 | Greater than |
| 3 | Less than |
| 4 | Contains |
| 5 | Does not contain |
| 100 | Is |
| 101 | Is not |
| 999 | Has any value |

## Repeat N Times

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

<!-- (loop body actions here) -->

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

## Repeat with Each

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

<!-- (loop body actions here) -->

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

## Choose from Menu

Menu start (mode 0), one menu item per option (mode 1), menu end (mode 2):

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

<!-- (actions for Option A here) -->

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

<!-- (actions for Option B here) -->

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
