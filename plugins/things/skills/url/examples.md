# Things URL Scheme Examples

Detailed usage examples for the `url.js` wrapper and raw URL scheme commands.

## Creating Todos

### Simple Todo

```bash
osascript ${CLAUDE_PLUGIN_ROOT}/scripts/url.js add title="Task name" when=today tags=Work
```

### Todo with Full Details

```bash
osascript ${CLAUDE_PLUGIN_ROOT}/scripts/url.js add title="Quarterly Review" notes="Review goals and metrics" when=2025-11-01 deadline=2025-11-07 tags=Work,Planning
```

### Multiple Todos at Once

```bash
osascript ${CLAUDE_PLUGIN_ROOT}/scripts/url.js add titles="Buy milk
Pick up dry cleaning
Walk dog" when=today
```

### Todo with Checklist (JSON)

```bash
data='[{
  "type": "to-do",
  "attributes": {
    "title": "Prepare presentation",
    "when": "today",
    "tags": ["Work"],
    "checklist-items": [
      {"type": "checklist-item", "attributes": {"title": "Create slides"}},
      {"type": "checklist-item", "attributes": {"title": "Prepare talking points"}}
    ]
  }
}]'
open -g "things:///json?data=$(echo "$data" | jq -sRr @uri)"
```

### Todo in Specific Project

```bash
osascript ${CLAUDE_PLUGIN_ROOT}/scripts/url.js add title="Write chapter 3" list="Book Writing" when=anytime
```

## Creating Projects

### Simple Project

```bash
osascript ${CLAUDE_PLUGIN_ROOT}/scripts/url.js add-project title="Website Redesign" when=today tags=Work
```

### Project with Todos

```bash
osascript ${CLAUDE_PLUGIN_ROOT}/scripts/url.js add-project title="Plan vacation" when=tomorrow to-dos="Research destinations
Book flights
Book hotel"
```

### Complex Project (JSON)

```bash
data='[{
  "type": "project",
  "attributes": {
    "title": "Launch New Feature",
    "when": "today",
    "deadline": "2025-11-30",
    "tags": ["Work"],
    "area": "Engineering",
    "items": [
      {"type": "heading", "attributes": {"title": "Planning"}},
      {"type": "to-do", "attributes": {"title": "Write spec"}},
      {"type": "to-do", "attributes": {"title": "Review with team"}},
      {"type": "heading", "attributes": {"title": "Implementation"}},
      {"type": "to-do", "attributes": {"title": "Build backend"}},
      {"type": "to-do", "attributes": {"title": "Build frontend"}}
    ]
  }
}]'
open -g "things:///json?data=$(echo "$data" | jq -sRr @uri)"
```

## Updating Todos

Auth token is fetched automatically by `url.js` (see [1password.md](1password.md) for setup).

```bash
osascript ${CLAUDE_PLUGIN_ROOT}/scripts/url.js update id=ABC-123 append-notes="Additional info"
osascript ${CLAUDE_PLUGIN_ROOT}/scripts/url.js update id=ABC-123 add-tags=Urgent,Important
osascript ${CLAUDE_PLUGIN_ROOT}/scripts/url.js update id=ABC-123 when=tomorrow
osascript ${CLAUDE_PLUGIN_ROOT}/scripts/url.js update id=ABC-123 completed=true
osascript ${CLAUDE_PLUGIN_ROOT}/scripts/url.js update id=ABC-123 list="New Project"
osascript ${CLAUDE_PLUGIN_ROOT}/scripts/url.js update id=ABC-123 append-checklist-items="Item 1
Item 2"
```

## Navigation and Search

```bash
osascript ${CLAUDE_PLUGIN_ROOT}/scripts/url.js show id=today
osascript ${CLAUDE_PLUGIN_ROOT}/scripts/url.js show id=inbox
osascript ${CLAUDE_PLUGIN_ROOT}/scripts/url.js show id=ABC-123
osascript ${CLAUDE_PLUGIN_ROOT}/scripts/url.js search query="meeting notes"
```

## Linking Tasks

```bash
osascript ${CLAUDE_PLUGIN_ROOT}/scripts/url.js add title="Follow up: Review proposal" notes="Original task: things:///show?id=ABC-123" when=tomorrow
osascript ${CLAUDE_PLUGIN_ROOT}/scripts/url.js update id=ABC-123 append-notes="Related: things:///show?id=DEF-456"
```
