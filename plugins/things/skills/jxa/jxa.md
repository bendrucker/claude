# Things 3 AppleScript/JXA Reference

Object model for Things 3 automation via JXA.

Source: Things3.sdef (AppleScript dictionary from Things.app). Regenerate with:

```bash
sdef /Applications/Things3.app > Things3.sdef
```

Typed version: `src/Things3.d.ts` (see [setup.md](setup.md)).

## Syntax Facts

- Read properties by calling them: `todo.name()`. Write by assignment: `todo.name = "New title"`.
- Look up by ID: `app.lists.byId("TMTodayListSource")`, `app.toDos.byId("ABC-123")`.
- Filter with `whose` on the specifier (not the array): `app.toDos.whose({name: "Buy milk"})[0]`. Returns an array. Index `[0]` and check for undefined.
- `status()` returns an enum. Convert with `.toString()` before comparing to `"open"` etc.
- Nullable properties (`project`, `area`, `dueDate`, ...) need null checks before chaining.
- Dates are JS `Date` objects both ways. Clear a date by assigning `null`.
- Collections returned by calls like `list.toDos()` lack JS array methods. Iterate with for loops (see [setup.md](setup.md)).

## Application Object

Read-only properties: `name`, `frontmost`, `version`, `currentListUrl` (hidden), `currentListName` (hidden)

Elements: `windows`, `lists`, `toDos` (all to-dos), `projects`, `areas`, `contacts`, `tags`, `selectedToDos`

## List Object

A Things list (Inbox, Today, Anytime, etc.).

Properties: `id` (read-only), `name`

Elements: `toDos`

Methods: `show()` shows the list in the Things UI

Built-in list IDs are listed in [SKILL.md](SKILL.md).

## To Do Object

#### Properties

- `id` (text, read-only)
- `name` (text) - Todo title
- `notes` (text)
- `creationDate`, `modificationDate`, `dueDate`, `completionDate`, `cancellationDate` (date)
- `activationDate` (date, read-only) - Scheduled start date
- `status` (enum: `open`/`completed`/`canceled`)
- `tagNames` (text) - Comma-separated tag names
- `project` (project object) - Parent project, nullable
- `area` (area object) - Parent area, nullable
- `contact` (contact object) - Assigned contact, nullable

#### Elements

- `tags`

#### Methods

- `show()` - Show in Things UI
- `edit()` - Open edit dialog
- `move({to: list})` - Move to different list
- `schedule({for: date})` - Schedule for specific date

## Project Object

Inherits from To Do, adds element `toDos` (the project's to-dos).

## Area Object

Inherits from List.

Additional properties: `tagNames` (comma-separated), `collapsed` (boolean)

Elements: `toDos`, `tags`

## Tag Object

Properties: `id` (read-only), `name`, `keyboardShortcut`, `parentTag` (tag object, nullable)

Elements: `tags` (child tags), `toDos`

Avoid `tag.toDos().length` for counts: it includes logbook items (13K+) and is extremely slow.

## Contact Object

Inherits from List. Element `toDos` holds to-dos assigned to the contact.

## Status Enumeration

`open`, `completed`, `canceled`. Readable and writable: `todo.status = "completed"`.

## Repeating Tasks

Things does not expose repeating-task configuration through JXA. Detection heuristics and runnable scripts: [troubleshooting.md](troubleshooting.md#filtering-repeating-tasks).
