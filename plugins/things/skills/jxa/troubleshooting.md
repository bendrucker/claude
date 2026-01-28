# Things 3 Troubleshooting

Common issues, solutions, and best practices for Things automation.

## Things App Not Running

JXA commands require Things 3 to be running. If not running, you'll see errors like:

```
Error: Application can't be found.
```

**Launch Things before running commands:**

```bash
open -g -a "Things3"
```

The `-g` flag opens in background without stealing focus.

### Sandbox Errors vs App Not Running

**Important**: Sandbox permission errors can look similar to "app not running" errors. If you see errors about file access or permissions, the issue is likely sandbox restrictions, not Things being closed.

Sandbox errors typically mention:
- `Operation not permitted`
- `Sandbox: deny`
- File path access errors

The skill's hook automatically runs osascript commands outside the sandbox. If you still see sandbox errors, verify the hook is active or run the command with `dangerouslyDisableSandbox: true`.

## Updates Not Working

If `things:///update` doesn't apply changes:

### 1. Verify Auth Token

Check that your keychain token matches Things settings:

```bash
# Get token from keychain
auth_token=$(security find-generic-password -a "$USER" -s "things-auth-token" -w)
echo "Keychain token: $auth_token"

# Compare with Things > Settings > General > "Enable Things URLs" > Auth Token
```

If they don't match, update the keychain (see `@1password.md`):

```bash
# Delete old token
security delete-generic-password -a "$USER" -s "things-auth-token"

# Store new token
AUTH_TOKEN=$(op item get 5iene5gxngiqrxknafb7gslm4q --fields label=credential --reveal)
security add-generic-password -a "$USER" -s "things-auth-token" -w "$AUTH_TOKEN" -U
unset AUTH_TOKEN
```

### 2. Verify Updates Immediately

ALWAYS read the todo back with JXA after updating to confirm changes applied:

```bash
# Update
open "things:///update?id=ABC-123&auth-token=$auth_token&append-notes=New%20info"

# Verify (read back the same todo)
scripts/run-jxa.sh 'const app = Application("Things3"); const todo = app.toDos.byId("ABC-123"); console.log(JSON.stringify({id: todo.id(), name: todo.name(), notes: todo.notes()}, null, 2));'
```

### 3. Common Update Issues

**Wrong ID format**: IDs should be uppercase hex like `ABC-123` or UUIDs
**Missing auth token**: All updates require `auth-token` parameter
**URL encoding**: Notes with special characters must be URL-encoded
**Rate limiting**: Max 250 operations per 10 seconds
**Moving to area**: Use `list-id` (not `area-id`) when moving a todo to an area:
```bash
# Does NOT work:
open "things:///update?id=TODO_ID&auth-token=$auth_token&area-id=AREA_ID"

# Works:
open "things:///update?id=TODO_ID&auth-token=$auth_token&list-id=AREA_ID"
```

## Filtering Repeating Tasks

Things doesn't expose repeating task configuration through JXA, but you can detect repeating instances using a reliable heuristic.

### Detection Rule

**A task is a repeating instance if `creationDate` is at midnight local time (00:00:00).**

When Things auto-generates a task from a repeating template:
- `creationDate` is set to midnight (00:00:00) in local time
- Manually created tasks have creation timestamps with non-zero hours/minutes/seconds

### How to Detect

```bash
scripts/run-jxa.sh '
const app = Application("Things3");
const today = app.lists.byId("TMTodayListSource");

// Check if a task is a repeating instance
const todo = today.toDos()[0];
const props = todo.properties();

const isRepeatingInstance = props.creationDate &&
  props.creationDate.getHours() === 0 &&
  props.creationDate.getMinutes() === 0 &&
  props.creationDate.getSeconds() === 0;

console.log(isRepeatingInstance ? "Repeating instance" : "Manual task");
'
```

### Filter Out Repeating Tasks

Exclude repeating instances from processing:

```bash
scripts/run-jxa.sh '
const app = Application("Things3");
const today = app.lists.byId("TMTodayListSource");

const nonRepeating = today.toDos().filter(todo => {
  const props = todo.properties();

  // Keep tasks with missing dates
  if (!props.creationDate) return true;

  // Filter out repeating instances (created at midnight)
  return props.creationDate.getHours() !== 0 ||
         props.creationDate.getMinutes() !== 0 ||
         props.creationDate.getSeconds() !== 0;
}).map(todo => {
  const props = todo.properties();
  return {
    id: props.id,
    name: props.name,
    notes: props.notes || ""
  };
});

JSON.stringify(nonRepeating, null, 2);
'
```

### Finding Repeating Templates

Templates are todos with `activationDate: null`:

```bash
scripts/run-jxa.sh '
const app = Application("Things3");

// Get all repeating templates
const templates = app.toDos().filter(todo => {
  const props = todo.properties();
  return props.activationDate === null && props.status === "open";
}).map(todo => {
  const props = todo.properties();
  return {
    id: props.id,
    name: props.name,
    creationDate: props.creationDate
  };
});

JSON.stringify(templates, null, 2);
'
```

### Matching Instances to Templates

Find the template for a specific instance:

```bash
scripts/run-jxa.sh '
const app = Application("Things3");

function findRepeatingTemplate(taskName) {
  return app.toDos().filter(todo => {
    const props = todo.properties();
    return props.name === taskName &&
           props.activationDate === null &&
           props.status === "open";
  })[0];
}

// Check if task is repeating
const today = app.lists.byId("TMTodayListSource");
const task = today.toDos()[0];
const taskProps = task.properties();

const template = findRepeatingTemplate(taskProps.name);

if (template) {
  console.log(`${taskProps.name} is a repeating task`);
  console.log(`Template ID: ${template.id()}`);
} else {
  console.log(`${taskProps.name} is NOT repeating`);
}
'
```

### Key Insights

- **Repeating instance**: `creationDate` is at midnight (00:00:00 local time)
- **Manual task**: `creationDate` has non-zero hours/minutes/seconds
- **Template signature**: `activationDate: null` (templates are not scheduled)
- **No direct link**: Things doesn't expose template-to-instance relationships via JXA
- **Name matching**: Templates and instances share the same `name`

## Best Practices

### Always Verify Updates

```bash
# BAD: Update without verification
open "things:///update?id=ABC-123&auth-token=$auth_token&completed=true"

# GOOD: Update and verify
open "things:///update?id=ABC-123&auth-token=$auth_token&completed=true"
scripts/run-jxa.sh 'const app = Application("Things3"); const todo = app.toDos.byId("ABC-123"); console.log(todo.status().toString());'
```

### Retrieve Auth Token Per Session

Don't hardcode tokens; retrieve from keychain when needed:

```bash
# At start of automation session
AUTH_TOKEN=$(security find-generic-password -a "$USER" -s "things-auth-token" -w)

# Use for all updates
open "things:///update?id=ABC-123&auth-token=$AUTH_TOKEN&..."
open "things:///update?id=DEF-456&auth-token=$AUTH_TOKEN&..."
```

### URL Encode Properly

Use `jq` for reliable URL encoding:

```bash
# Encode notes
notes=$'\n\nAdditional info\nWith newlines'
encoded=$(echo "$notes" | jq -sRr @uri)

# Use in URL
open "things:///update?id=ABC-123&auth-token=$auth_token&append-notes=$encoded"
```

### Handle Missing Values

Use optional chaining in JXA for properties that might be null:

```javascript
const todo = app.toDos.byId("ABC-123");

// SAFE: Returns undefined if no project/due date
const projectName = todo.project()?.name();
const dueDate = todo.dueDate()?.toString();

// Map with safe access
const todos = today.toDos().map(todo => ({
  id: todo.id(),
  name: todo.name(),
  project: todo.project()?.name() || null,
  due: todo.dueDate()?.toISOString() || null
}));
```

### Batch Operations Carefully

Respect rate limits (250 operations per 10 seconds):

```bash
# Add small delays between operations
for todo_id in $todo_ids; do
  open "things:///update?id=$todo_id&auth-token=$AUTH_TOKEN&add-tags=Processed"
  sleep 0.1  # 100ms delay
done
```

## Reorder Script Issues

The `scripts/reorder.js` script requires running outside the sandbox to access the keychain for auth tokens. The skill's hook automatically handles this for `osascript` commands.

If reorder fails with permission errors:
1. Verify the hook is active (check skill frontmatter)
2. Ensure the command starts with `osascript` (the hook matches `Bash(osascript:*)`)

**Correct invocation:**
```bash
osascript scripts/reorder.js <id1> <id2> <id3>
```

## Error Messages

**"Invalid auth token"**: Token mismatch - update keychain from 1Password

**"Todo not found"**: Wrong ID format or todo was deleted

**"Operation not permitted"**: Missing `auth-token` parameter for updates

**"Too many requests"**: Hit rate limit - add delays between operations

**JXA "Can't get object"**: Trying to access property of null/undefined - use optional chaining
