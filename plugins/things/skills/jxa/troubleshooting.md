# Things 3 Troubleshooting

## Sandbox Errors

`Operation not permitted`, `Sandbox: deny`, file path access errors, and `A privilege violation occurred. (-10004)` come from the sandbox, while `Application can't be found` means Things is closed.

Sandboxed `osascript` Apple Events to Things3 fail with `-10004` even with `sandbox.allowAppleEvents` set, because that key covers Launch Services `open`/URL handoff only. The `mac:jxa-run` skill's inline hook runs the JXA runner outside the sandbox. On `-10004`, verify that hook is active or run the command with `dangerouslyDisableSandbox: true`.

## Updates Not Working

When `things:///update` doesn't apply changes, compare the keychain token against Things > Settings > General > "Enable Things URLs" > Auth Token:

```bash
security find-generic-password -a "$USER" -s "things-auth-token" -w
```

On a mismatch, update the keychain from 1Password (commands in [1password.md](../url/1password.md)).

URL-scheme writes are silent on success and failure. After an update, read the todo back with JXA to confirm the change applied.

#### Common Update Issues

- IDs are uppercase hex like `ABC-123`, or UUIDs.
- URL-encode notes with special characters (`jq -sRr @uri`).
- Assign an area before completing an item. Setting `list-id` on a completed item moves it to Logbook instead.
- Move to an area with `list-id`: `things:///update?id=TODO_ID&auth-token=$auth_token&list-id=AREA_ID`

## Filtering Repeating Tasks

JXA doesn't expose repeating-task configuration. Detect by timestamps instead:

- Repeating instance: `creationDate` at exactly 00:00:00 local time, which Things sets when it generates from a template.
- Manual task: `creationDate` with non-zero hours, minutes, or seconds.
- Template: `activationDate === null` with `status === "open"`. Templates and instances share `name`, so match on that.

Today's list without repeating instances (run through `mac:jxa-run Things3 -e`):

```javascript
var app = Application("Things3");
var todos = app.lists.byId("TMTodayListSource").toDos();
var result = [];
for (var i = 0; i < todos.length; i++) {
  var p = todos[i].properties();
  var d = p.creationDate;
  if (!d || d.getHours() || d.getMinutes() || d.getSeconds()) {
    result.push({id: p.id, name: p.name, notes: p.notes || ""});
  }
}
JSON.stringify(result, null, 2)
```

## Reorder Script Issues

`scripts/reorder.ts` reads the keychain auth token. It runs outside the sandbox through the `things:url` skill's inline hook. On permission errors, verify the hook is active and the command matches `Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/reorder.ts:*)`.

## Error Messages

- "Invalid auth token": token mismatch. Update the keychain from 1Password.
- "Todo not found": wrong ID format, or the todo was deleted.
- "Operation not permitted": the update lacks the `auth-token` parameter.
- "Too many requests": rate limit. Add delays between operations.
- JXA "Can't get object": a property read on null. Null-check first.
