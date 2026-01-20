# Things 3 URL Scheme Reference

Complete documentation for Things 3 automation via URL schemes.

**Source**: [Things URL Scheme](https://culturedcode.com/things/support/articles/2803573/)

## Table of Contents

1. [URL Scheme Commands](#url-scheme-commands)
2. [URL Scheme Parameters](#url-scheme-parameters)
3. [JSON Command Format](#json-command-format)
4. [Data Types and Formats](#data-types-and-formats)
5. [Limitations and Rate Limits](#limitations-and-rate-limits)

---

## URL Scheme Commands

All commands follow the pattern: `things:///commandName?param1=value1&param2=value2`

### add - Create To-dos

Creates new to-do items in Things.

**Parameters:**
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

**Note on `list` vs `list-id`:**
- `list` works with **project names** only
- For **areas**, you must use `list-id` with the area's UUID
- To find area IDs, use JXA: `app.areas().map(a => ({name: a.name(), id: a.id()}))`

**Example:**
```bash
open -g "things:///add?title=Buy%20milk&notes=Low%20fat&when=evening&tags=Errand"
```

### add-project - Create Projects

Creates new projects with optional to-dos and areas.

**Parameters:**
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

**Example:**
```bash
open -g "things:///add-project?title=Build%20treehouse&when=today&area=Home"
```

### update - Modify To-dos

Updates existing to-do properties. **Requires `auth-token` and `id`.**

**Parameters:**
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

**Example:**
```bash
open -g "things:///update?id=4BE64FEA-8FEF-4F4F-B8B2-4E74605D5FA5&auth-token=YOUR_TOKEN&append-notes=Updated%20info"
```

**Notes:**
- Cannot update `when` or `deadline` on repeating to-dos
- To move to an area, use `list-id` with the area ID (not `area-id`)
- Projects require all child to-dos completed before marking complete

### update-project - Modify Projects

Updates existing project properties. **Requires `auth-token` and `id`.**

Supports same parameters as `update` plus:
- `area` or `area-id` - Move to different area

### show - Navigate & Display

Navigates to specific items or built-in lists.

**Parameters:**
- `id` (string) - Item ID or built-in list name
- `query` (string) - Search by name instead of ID
- `filter` (comma-separated) - Filter results by tags

**Built-in List IDs:**
- `inbox` - Inbox
- `today` - Today
- `anytime` - Anytime
- `upcoming` - Upcoming
- `someday` - Someday
- `logbook` - Logbook
- `tomorrow` - Tomorrow
- `deadlines` - Deadlines
- `repeating` - Repeating
- `all-projects` - All Projects
- `logged-projects` - Logged Projects

**Example:**
```bash
open -g "things:///show?id=today"
open -g "things:///show?query=Weekly%20Review&filter=Work,Planning"
```

### search - Open Search

Invokes the search interface.

**Parameters:**
- `query` (string, optional) - Pre-filled search text

**Example:**
```bash
open -g "things:///search?query=meeting%20notes"
```

### version - Check Compatibility

Returns app and URL scheme version information.

**Example:**
```bash
open -g "things:///version"
```

---

## URL Scheme Parameters

### Common Parameter Types

**String Parameters:**
- Max 4,000 characters (unless specified)
- Must be URL-encoded
- Use `%20` for spaces, `%0a` for newlines

**Date Parameters:**
- Named values: `today`, `tomorrow`
- ISO format: `yyyy-mm-dd`
- Natural language: `in 3 days`, `next week`, `May 5`
- Date-time: `yyyy-mm-dd@HH:MM`
- ISO8601: Full timestamp support

**Boolean Parameters:**
- Values: `true` or `false`

**List Parameters:**
- Comma-separated: `tag1,tag2,tag3`
- Newline-separated: `item1%0aitem2%0aitem3`

---

## JSON Command Format

The `json` command enables creating complex structures with projects, to-dos, headings, and checklist items.

**Basic Usage:**
```bash
data='[{"type":"to-do","attributes":{"title":"Task name"}}]'
open -g "things:///json?data=$(echo "$data" | jq -sRr @uri)"
```

### Supported Object Types

**to-do:**
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

**project:**
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

**heading:**
```json
{
  "type": "heading",
  "attributes": {
    "title": "Heading title"
  }
}
```

**checklist-item:**
```json
{
  "type": "checklist-item",
  "attributes": {
    "title": "Checklist item title"
  }
}
```

### Operations

**Create (default):**
```json
{
  "type": "to-do",
  "operation": "create",
  "attributes": {...}
}
```

**Update:**
```json
{
  "type": "to-do",
  "operation": "update",
  "id": "ABC-123",
  "attributes": {...}
}
```

### Additional Parameters

- `auth-token` - Required for update operations
- `reveal` - Navigate to created/updated item

**Complete Example:**
```bash
data='[
  {
    "type": "project",
    "attributes": {
      "title": "Shopping List",
      "when": "today",
      "items": [
        {
          "type": "to-do",
          "attributes": {
            "title": "Groceries",
            "checklist-items": [
              {"type": "checklist-item", "attributes": {"title": "Milk"}},
              {"type": "checklist-item", "attributes": {"title": "Eggs"}}
            ]
          }
        }
      ]
    }
  }
]'
open -g "things:///json?data=$(echo "$data" | jq -sRr @uri)"
```

---

## Data Types and Formats

### URL Encoding

All URL parameters must be properly encoded:
- Space → `%20`
- Newline → `%0a`
- Comma → `%2C` (if not used as separator)
- `&` → `%26`
- `#` → `%23`

Use `jq -sRr @uri` or similar tools for encoding.

### Date Formats

**Named Values:**
- `today` - Today
- `tomorrow` - Tomorrow
- `evening` - This evening

**ISO Date:**
- `yyyy-mm-dd` - e.g., `2025-10-21`

**Date-Time:**
- `yyyy-mm-dd@HH:MM` - e.g., `2025-10-21@14:30`

**Natural Language:**
- `in 3 days`
- `next week`
- `May 5`
- `December 25, 2025`

**ISO8601 Timestamps:**
- Full ISO8601 format supported

### When Values

Controls when a to-do appears:
- `today` - Today list
- `tomorrow` - Scheduled for tomorrow
- `evening` - This Evening in Today
- `anytime` - Anytime list
- `someday` - Someday list
- Date string - Scheduled for specific date

---

## Limitations and Rate Limits

### Rate Limiting
- Maximum **250 items** can be added within 10 seconds
- Exceeding limit results in throttling

### Item Limits
- **Checklist items**: Maximum 100 per to-do
- **Notes**: Maximum 10,000 characters
- **Title**: Maximum 4,000 characters (URL params)

### Update Restrictions
- **Repeating to-dos**: Cannot update `when` or `deadline` fields
- **Projects**: All child to-dos must be completed before marking project complete
- **Auth token required**: All `update`, `update-project` operations and `json` updates require auth token from Things > Settings > General

### Data Constraints
- JSON payload size limited by URL length constraints
- Complex structures should use `json` command instead of individual `add` commands
