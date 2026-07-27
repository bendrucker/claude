# Things 3 URL Scheme Reference

All commands follow the pattern: `things:///commandName?param1=value1&param2=value2`

**Source**: [Things URL Scheme](https://culturedcode.com/things/support/articles/2803573/)

## add - Create To-dos

#### Parameters
- `title` (string) - Todo title
- `titles` (newline-separated) - Multiple todos (`%0a` separator)
- `notes` (string, max 10,000 chars) - Todo notes
- `when` (string) - Schedule: `today`, `tomorrow`, `evening`, `anytime`, `someday`, or date
- `deadline` (date string) - Due date in `yyyy-mm-dd` format
- `tags` (comma-separated) - Tag names
- `checklist-items` (newline-separated, max 100) - Checklist items
- `list` or `list-id` - Project/area destination (see note below)
- `heading` or `heading-id` - Heading within a project
- `completed` (boolean) - Mark as completed
- `canceled` (boolean) - Mark as canceled
- `reveal` (boolean) - Navigate to new item after creation

**Note on `list` vs `list-id`:** `list` works with **project names** only. For **areas**, you must use `list-id` with the area's UUID (query area IDs via the `things:jxa` skill).

## add-project - Create Projects

#### Parameters
- `title` (string) - Project title
- `notes` (string) - Project notes
- `when` (string) - Schedule start date
- `deadline` (date string) - Project due date
- `tags` (comma-separated) - Tag names
- `area` or `area-id` - Area name or ID
- `to-dos` (newline-separated) - Todo titles within the project
- `completed` (boolean) - Mark as completed
- `canceled` (boolean) - Mark as canceled
- `reveal` (boolean) - Navigate to new project

## update - Modify To-dos

**Requires `auth-token` and `id`.**

#### Parameters
- `id` (string, required) - Todo ID
- `auth-token` (string, required) - Authorization token from Settings
- `title` (string) - New title (replaces existing)
- `notes` (string) - New notes (replaces existing)
- `prepend-notes` (string) - Add text before existing notes
- `append-notes` (string) - Add text after existing notes
- `when` (string) - Reschedule
- `deadline` (date string) - New due date
- `tags` (comma-separated) - Replace all tags
- `add-tags` (comma-separated) - Add tags without replacing
- `checklist-items` (newline-separated) - Replace all checklist items
- `prepend-checklist-items` (newline-separated) - Add items at top
- `append-checklist-items` (newline-separated) - Add items at bottom
- `list` or `list-id` - Move to different project/area
- `completed` (boolean) - Mark as completed/incomplete
- `canceled` (boolean) - Mark as canceled
- `duplicate` (boolean) - Create copy before updating
- `reveal` (boolean) - Navigate to updated item

#### Notes
- Cannot update `when` or `deadline` on repeating to-dos
- Projects require all child to-dos completed before marking complete

## update-project - Modify Projects

**Requires `auth-token` and `id`.** Supports the same parameters as `update` plus `area` or `area-id` to move to a different area.

## show - Navigate & Display

#### Parameters
- `id` (string) - Item ID or built-in list name
- `query` (string) - Search by name instead of ID
- `filter` (comma-separated) - Filter results by tags

**Built-in List IDs:** `inbox`, `today`, `anytime`, `upcoming`, `someday`, `logbook`, `tomorrow`, `deadlines`, `repeating`, `all-projects`, `logged-projects`

## search - Open Search

#### Parameters
- `query` (string, optional) - Pre-filled search text

## version - Check Compatibility

Returns app and URL scheme version information. No parameters.

## Parameter Types

- **Strings**: max 4,000 characters unless specified, URL-encoded (`%20` space, `%0a` newline). Encode with `jq -sRr @uri`.
- **Dates**: named (`today`, `tomorrow`, `evening`), ISO (`yyyy-mm-dd`), date-time (`yyyy-mm-dd@HH:MM`), full ISO8601, or natural language (`in 3 days`, `next week`, `May 5`)
- **Booleans**: `true` or `false`
- **Lists**: comma-separated (`tag1,tag2`) or newline-separated (`item1%0aitem2`)

## JSON Command Format

The `json` command creates complex structures with projects, to-dos, headings, and checklist items.

```bash
data='[{"type":"to-do","attributes":{"title":"Task name"}}]'
open -g "things:///json?data=$(echo "$data" | jq -sRr @uri)"
```

### Supported Object Types

#### to-do
```json
{
  "type": "to-do",
  "attributes": {
    "title": "Task title",
    "notes": "Task notes",
    "when": "today",
    "deadline": "2025-12-31",
    "tags": ["tag1", "tag2"],
    "checklist-items": [
      {"type": "checklist-item", "attributes": {"title": "Item 1"}}
    ]
  }
}
```

#### project
```json
{
  "type": "project",
  "attributes": {
    "title": "Project title",
    "notes": "Project notes",
    "when": "today",
    "deadline": "2025-12-31",
    "tags": ["tag1"],
    "area": "Area name",
    "items": [
      {"type": "to-do", "attributes": {"title": "Task 1"}},
      {"type": "heading", "attributes": {"title": "Section 1"}},
      {"type": "to-do", "attributes": {"title": "Task 2"}}
    ]
  }
}
```

**heading** and **checklist-item**: same shape, with only `title` in `attributes`.

### Operations

Each object takes an optional `"operation"`: `"create"` (default) or `"update"`. Updates also require a top-level `"id"` on the object and the `auth-token` URL parameter. `reveal` navigates to the created/updated item.

## Limitations

- **Rate limit**: maximum 250 items within 10 seconds. Exceeding it results in throttling.
- **Auth token**: required for `update`, `update-project`, and `json` updates. From Things > Settings > General.
- **JSON payload**: size limited by URL length. Prefer the `json` command over many individual `add` commands for complex structures.
