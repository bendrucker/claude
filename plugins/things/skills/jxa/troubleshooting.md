# Things 3 Troubleshooting

## Things App Not Running

JXA commands require Things 3 to be running. If not, you'll see `Error: Application can't be found.` Launch it in the background:

```bash
open -g -a "Things3"
```

### Sandbox Errors vs App Not Running

Sandbox permission errors can look similar. Errors mentioning `Operation not permitted`, `Sandbox: deny`, file path access, or `A privilege violation occurred. (-10004)` are sandbox restrictions, not Things being closed.

Sandboxed `osascript` Apple Events to Things3 fail with `-10004` even with `sandbox.allowAppleEvents` set (that key covers Launch Services `open`/URL handoff, not `osascript`). The `mac:jxa-run` skill's inline hook runs the JXA runner outside the sandbox for this reason. If you see `-10004`, verify that hook is active or run the command with `dangerouslyDisableSandbox: true`.

## Updates Not Working

If `things:///update` doesn't apply changes, check the auth token first. Compare the keychain token against Things > Settings > General > "Enable Things URLs" > Auth Token:

```bash
security find-generic-password -a "$USER" -s "things-auth-token" -w
```

If they don't match, update the keychain from 1Password (commands in [1password.md](../url/1password.md)).

URL-scheme writes can succeed silently or fail silently. After an update, read the todo back with JXA to confirm the change applied.

### Common Update Issues

- **Wrong ID format**: IDs should be uppercase hex like `ABC-123` or UUIDs
- **URL encoding**: notes with special characters must be URL-encoded (`jq -sRr @uri`)
- **Completed items**: setting `list-id` (area) on a completed item silently fails. The item moves to Logbook instead. Assign areas before completing.
- **Moving to area**: use `list-id` (not `area-id`): `things:///update?id=TODO_ID&auth-token=$auth_token&list-id=AREA_ID`

## Filtering Repeating Tasks

Things doesn't expose repeating task configuration through JXA, but repeating instances can be detected with a heuristic.

Detection rule: a task is a repeating instance if `creationDate` is at midnight local time (00:00:00). Things sets midnight timestamps when auto-generating from a repeating template. Manually created tasks have non-zero hours/minutes/seconds.

### Filter Out Repeating Tasks

```bash
osascript -l JavaScript -e '
var app = Application("Things3");
var today = app.lists.byId("TMTodayListSource");
var todos = today.toDos();
var result = [];
for (var i = 0; i < todos.length; i++) {
  var props = todos[i].properties();
  if (!props.creationDate) { result.push({id: props.id, name: props.name}); continue; }
  if (props.creationDate.getHours() !== 0 || props.creationDate.getMinutes() !== 0 || props.creationDate.getSeconds() !== 0) {
    result.push({id: props.id, name: props.name, notes: props.notes || ""});
  }
}
JSON.stringify(result, null, 2)
'
```

### Key Facts

- Repeating instance: `creationDate` at midnight (00:00:00 local time)
- Manual task: `creationDate` with non-zero hours/minutes/seconds
- Template signature: `activationDate === null` with `status === "open"` (templates are not scheduled)
- No direct link: Things doesn't expose template-to-instance relationships via JXA. Templates and instances share the same `name`, so match on that.

## Reorder Script Issues

`scripts/reorder.ts` requires running outside the sandbox to access the keychain for auth tokens. The `things:url` skill's inline hook handles this. If reorder fails with permission errors, verify the hook is active and the command matches `Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/reorder.ts:*)`.

## Error Messages

- **"Invalid auth token"**: token mismatch, update keychain from 1Password
- **"Todo not found"**: wrong ID format or todo was deleted
- **"Operation not permitted"**: missing `auth-token` parameter for updates
- **"Too many requests"**: hit rate limit, add delays between operations
- **JXA "Can't get object"**: accessing a property of null/undefined, check for null first
