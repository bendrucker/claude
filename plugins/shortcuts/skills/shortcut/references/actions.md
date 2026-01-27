# Shortcut Actions Reference

This file covers programming constructs and a selection of commonly-used built-in actions. It is not exhaustive — built-in actions change with each OS release and there are hundreds of them.

**On macOS**, use Phase 1 (Discovery) from the skill to read `WFActions.plist` for the full, current list. For third-party app actions, inspect app bundles or export existing shortcuts.

**On non-macOS**, this reference and Claude's general knowledge of the Shortcuts app are the fallback.

## Action Format

Every action is a dict with two keys:

```xml
<dict>
  <key>WFWorkflowActionIdentifier</key>
  <string>is.workflow.actions.alert</string>
  <key>WFWorkflowActionParameters</key>
  <dict>
    <!-- action-specific parameters -->
  </dict>
</dict>
```

Built-in actions use the `is.workflow.actions.*` prefix. Third-party apps use their bundle ID (e.g. `com.culturedcode.ThingsMac.*`).

## Control Flow

These are the core programming constructs. All use `GroupingIdentifier` (a UUID shared across the start/middle/end actions) and `WFControlFlowMode` (0 = start, 1 = middle, 2 = end).

| Action | Identifier | Key Parameters |
|--------|-----------|----------------|
| If / Otherwise / End If | `is.workflow.actions.conditional` | `WFCondition` (0=equals, 1=not equals, 2=gt, 3=lt, 4=contains, 5=not contains, 100=is, 101=is not, 999=has any value), `WFInput` |
| Repeat N Times | `is.workflow.actions.repeat.count` | `WFRepeatCount` (integer) |
| Repeat with Each | `is.workflow.actions.repeat.each` | `WFInput` (collection) |
| Choose from Menu | `is.workflow.actions.choosefrommenu` | `WFMenuPrompt` (string), `WFMenuItems` (array), `WFMenuItemTitle` (string, for mode 1) |

## Variables

| Action | Identifier | Key Parameters |
|--------|-----------|----------------|
| Set Variable | `is.workflow.actions.setvariable` | `WFVariableName` (string), `WFInput` |
| Get Variable | `is.workflow.actions.getvariable` | `WFVariable` (variable reference) |

To capture action output, add `UUID` and `CustomOutputName` to the source action's parameters. Reference it later via `WFTextTokenAttachment` with `OutputUUID`.

## Data Structures

| Action | Identifier | Key Parameters |
|--------|-----------|----------------|
| List | `is.workflow.actions.list` | `WFItems` (array of strings) |
| Get Item from List | `is.workflow.actions.getitemfromlist` | `WFInput`, `WFItemSpecifier` (`First Item`, `Last Item`, `Random Item`, `Item At Index`), `WFItemIndex` |
| Count | `is.workflow.actions.count` | `Input`, `WFCountType` (`Items`, `Characters`, `Words`, `Sentences`, `Lines`) |
| Dictionary | `is.workflow.actions.dictionary` | `WFItems` |
| Get Dictionary Value | `is.workflow.actions.getvalueforkey` | `WFInput`, `WFDictionaryKey`, `WFGetDictionaryValueType` (`Value`, `All Keys`, `All Values`) |
| Set Dictionary Value | `is.workflow.actions.setvalueforkey` | `WFDictionary`, `WFDictionaryKey`, `WFDictionaryValue` |
| Number | `is.workflow.actions.number` | `WFNumberActionNumber` |
| Calculate | `is.workflow.actions.math` | `WFInput`, `WFMathOperation` (`+`, `-`, `×`, `÷`, `Modulus`), `WFMathOperand` |
| Choose from List | `is.workflow.actions.choosefromlist` | `WFInput`, `WFChooseFromListActionPrompt`, `WFChooseFromListActionSelectMultiple` (bool) |

## Text

| Action | Identifier | Key Parameters |
|--------|-----------|----------------|
| Text | `is.workflow.actions.gettext` | `WFTextActionText` |
| Replace Text | `is.workflow.actions.text.replace` | `WFInput`, `WFReplaceTextFind`, `WFReplaceTextReplace`, `WFReplaceTextRegularExpression` (bool) |
| Match Text | `is.workflow.actions.text.match` | `WFInput`, `WFMatchTextPattern` (regex) |
| Split Text | `is.workflow.actions.text.split` | `WFInput`, `WFTextSeparator`, `WFTextCustomSeparator` |
| Combine Text | `is.workflow.actions.text.combine` | `WFInput`, `WFTextSeparator`, `WFTextCustomSeparator` |

## Input / Output

| Action | Identifier | Key Parameters |
|--------|-----------|----------------|
| Ask for Input | `is.workflow.actions.ask` | `WFAskActionPrompt`, `WFInputType` (`Text`, `Number`, `URL`, `Date`) |
| Show Alert | `is.workflow.actions.alert` | `WFAlertActionMessage`, `WFAlertActionTitle`, `WFAlertActionCancelButtonShown` (bool) |
| Show Result | `is.workflow.actions.showresult` | `Text` |
| Show Notification | `is.workflow.actions.notification` | `WFNotificationActionBody`, `WFNotificationActionTitle` |
| Comment | `is.workflow.actions.comment` | `WFCommentActionText` |
| Nothing | `is.workflow.actions.nothing` | (none) |
| Exit Shortcut | `is.workflow.actions.exit` | (none) |
| Stop and Output | `is.workflow.actions.output` | `WFOutput` |
| Run Shortcut | `is.workflow.actions.runworkflow` | `WFWorkflowName`, `WFInput` |

## Web / Network

| Action | Identifier | Key Parameters |
|--------|-----------|----------------|
| Get Contents of URL | `is.workflow.actions.downloadurl` | `WFInput` (URL), `WFHTTPMethod` (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`), `WFHTTPHeaders`, `WFHTTPBodyType` (`JSON`, `Form`, `File`), `WFJSONValues`, `WFFormValues` |
| URL | `is.workflow.actions.url` | `WFURLActionURL` |
| Open URL | `is.workflow.actions.openurl` | `WFInput` |
| Get Dictionary from Input | `is.workflow.actions.detect.dictionary` | `WFInput` |

## Default App Example: Calendar

These actions interact with the built-in Calendar app. Included as an example of how default app actions are structured — other default apps (Reminders, Contacts, Maps, Music, etc.) follow similar patterns.

| Action | Identifier | Key Parameters |
|--------|-----------|----------------|
| Find Calendar Events | `is.workflow.actions.filter.calendarevents` | `WFContentItemFilter` (filter dict), `WFContentItemSortProperty` (string), `WFContentItemSortOrder` (`Oldest First`, `Latest First`), `WFContentItemLimitEnabled` (bool), `WFContentItemLimit` (integer) |
| Add New Event | `is.workflow.actions.addnewcalendar` | `WFCalendarItemTitle` (string), `WFCalendarItemStartDate`, `WFCalendarItemEndDate`, `WFCalendarItemCalendar`, `WFCalendarItemLocation`, `WFCalendarItemNotes`, `WFCalendarItemAllDay` (bool) |
| Get Details of Calendar Events | `is.workflow.actions.properties.calendarevents` | `WFInput`, `WFContentItemPropertyName` (`Title`, `Start Date`, `End Date`, `Location`, `Calendar`, `Is All Day`, `Notes`, `URL`, `Attendees`, `Has Alarms`) |
| Remove Calendar Events | `is.workflow.actions.removecalendarevent` | `WFInput` |

## Discovering More Actions

This reference cannot be exhaustive. To find actions not listed here:

1. **macOS discovery**: Parse `WFActions.plist` from WorkflowKit.framework (see SKILL.md Phase 1)
2. **Export and inspect**: Create a shortcut in the GUI, export with `shortcuts export`, convert with `plutil -convert xml1`
3. **Database query**: Search `~/Library/Shortcuts/Shortcuts.sqlite` for action identifiers
