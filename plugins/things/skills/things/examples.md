# Things 3 Usage Examples

Practical examples for common Things automation tasks.

## Creating Todos

### Simple Todo

```bash
osascript scripts/url.js add title="Call dentist" when=today
```

### Todo with Full Details

```bash
osascript scripts/url.js add title="Quarterly Review" notes="Review goals and metrics" when=2025-11-01 deadline=2025-11-07 tags=Work,Planning
```

### Multiple Todos at Once

```bash
osascript scripts/url.js add titles="Buy milk
Pick up dry cleaning
Walk dog" when=today
```

### Todo with Checklist

```bash
data='[{
  "type": "to-do",
  "attributes": {
    "title": "Prepare presentation",
    "when": "today",
    "tags": ["Work"],
    "checklist-items": [
      {"type": "checklist-item", "attributes": {"title": "Create slides"}},
      {"type": "checklist-item", "attributes": {"title": "Prepare talking points"}},
      {"type": "checklist-item", "attributes": {"title": "Practice delivery"}}
    ]
  }
}]'
open "things:///json?data=$(echo "$data" | jq -sRr @uri)"
```

### Todo in Specific Project

```bash
# By project name
osascript scripts/url.js add title="Write chapter 3" list="Book Writing" when=anytime

# Or get project ID via JXA and use list-id
project_id=$(scripts/run-jxa.sh 'const app = Application("Things3"); const p = app.projects.whose({name: "Book Writing"})[0]; p ? p.id() : "";')
osascript scripts/url.js add title="Write chapter 3" list-id="$project_id" when=anytime
```

## Creating Projects

### Simple Project

```bash
osascript scripts/url.js add-project title="Website Redesign" when=today tags=Work
```

### Project with Todos

```bash
osascript scripts/url.js add-project title="Plan vacation" when=tomorrow to-dos="Research destinations
Book flights
Book hotel
Create itinerary"
```

### Project in Area

```bash
osascript scripts/url.js add-project title="Kitchen renovation" area=Home when=someday
```

### Complex Project with JSON

```bash
data='[{
  "type": "project",
  "attributes": {
    "title": "Launch New Feature",
    "when": "today",
    "deadline": "2025-11-30",
    "tags": ["Work", "Development"],
    "area": "Engineering",
    "items": [
      {"type": "heading", "attributes": {"title": "Planning"}},
      {"type": "to-do", "attributes": {"title": "Write spec"}},
      {"type": "to-do", "attributes": {"title": "Review with team"}},
      {"type": "heading", "attributes": {"title": "Implementation"}},
      {"type": "to-do", "attributes": {"title": "Build backend"}},
      {"type": "to-do", "attributes": {"title": "Build frontend"}},
      {"type": "heading", "attributes": {"title": "Launch"}},
      {"type": "to-do", "attributes": {"title": "Deploy to production"}},
      {"type": "to-do", "attributes": {"title": "Announce to users"}}
    ]
  }
}]'
open "things:///json?data=$(echo "$data" | jq -sRr @uri)"
```

## Reading Data with JXA

### Get All Inbox Todos

```bash
osascript -l JavaScript -e '
const app = Application("Things3");
const inbox = app.lists.byId("TMInboxListSource");
const todos = inbox.toDos().map(todo => ({
  id: todo.id(),
  name: todo.name(),
  notes: todo.notes(),
  tags: todo.tagNames(),
  createdAt: todo.creationDate()?.toString()
}));
JSON.stringify(todos, null, 2);
'
```

### Get Today's Todos

```bash
osascript -l JavaScript -e '
const app = Application("Things3");
const today = app.lists.byId("TMTodayListSource");
const todos = today.toDos().map(todo => {
  const status = todo.status().toString();
  return {
    id: todo.id(),
    name: todo.name(),
    status: status,
    project: todo.project()?.name(),
    dueDate: todo.dueDate()?.toString()
  };
});
JSON.stringify(todos, null, 2);
'
```

### Get All Projects

```bash
osascript -l JavaScript -e '
const app = Application("Things3");
const projects = app.projects().map(project => ({
  id: project.id(),
  name: project.name(),
  area: project.area()?.name(),
  status: project.status().toString(),
  todoCount: project.toDos().length
}));
JSON.stringify(projects, null, 2);
'
```

### Get All Areas

```bash
osascript -l JavaScript -e '
const app = Application("Things3");
const areas = app.areas().map(area => ({
  id: area.id(),
  name: area.name(),
  collapsed: area.collapsed(),
  todoCount: area.toDos().length
}));
JSON.stringify(areas, null, 2);
'
```

### Get All Tags

```bash
osascript -l JavaScript -e '
const app = Application("Things3");
const tags = app.tags().map(tag => ({
  id: tag.id(),
  name: tag.name(),
  parent: tag.parentTag()?.name(),
  shortcut: tag.keyboardShortcut(),
  todoCount: tag.toDos().length
}));
JSON.stringify(tags, null, 2);
'
```

### Find Todos by Tag

```bash
osascript -l JavaScript -e '
const app = Application("Things3");
const tag = app.tags.whose({name: "Work"})[0];
if (tag) {
  const todos = tag.toDos().map(todo => ({
    id: todo.id(),
    name: todo.name(),
    status: todo.status().toString()
  }));
  JSON.stringify(todos, null, 2);
} else {
  JSON.stringify({error: "Tag not found"});
}
'
```

### Get Project Todos

```bash
osascript -l JavaScript -e '
const app = Application("Things3");
const project = app.projects.whose({name: "Website Redesign"})[0];
if (project) {
  const todos = project.toDos().map(todo => ({
    id: todo.id(),
    name: todo.name(),
    status: todo.status().toString(),
    notes: todo.notes()
  }));
  JSON.stringify(todos, null, 2);
} else {
  JSON.stringify({error: "Project not found"});
}
'
```

## Updating Todos

Auth token is fetched automatically by `osascript scripts/url.js` (see `@1password.md` for setup).

### Append Notes

```bash
todo_id=$(scripts/run-jxa.sh 'const app = Application("Things3"); const t = app.lists.byId("TMTodayListSource").toDos().whose({name: "Call dentist"})[0]; t ? t.id() : "";')
osascript scripts/url.js update id="$todo_id" append-notes="Appointment at 2pm"
```

### Add Tags / Move / Reschedule / Complete

```bash
osascript scripts/url.js update id=ABC-123 add-tags=Urgent,Important
osascript scripts/url.js update id=ABC-123 list="New Project"
osascript scripts/url.js update id=ABC-123 when=tomorrow
osascript scripts/url.js update id=ABC-123 completed=true
osascript scripts/url.js update id=ABC-123 append-checklist-items="Item 1
Item 2"
```

## Navigation

### Show Built-in Lists

```bash
osascript scripts/url.js show id=today
osascript scripts/url.js show id=inbox
osascript scripts/url.js show id=upcoming
osascript scripts/url.js show id=anytime
```

### Show Specific Todo

```bash
osascript scripts/url.js show id=ABC-123
```

### Show Project

```bash
project_id=$(scripts/run-jxa.sh 'const app = Application("Things3"); const p = app.projects.whose({name: "Website Redesign"})[0]; p ? p.id() : "";')
osascript scripts/url.js show id="$project_id"
```

### Search

```bash
osascript scripts/url.js search query="meeting notes"
```

## Advanced Workflows

### Daily Planning Script

```bash
#!/bin/bash

# Get today's todos
echo "Today's Todos:"
scripts/run-jxa.sh 'const app = Application("Things3"); const today = app.lists.byId("TMTodayListSource"); JSON.stringify(today.toDos().map(t => ({name: t.name(), project: t.project()?.name() || "None", dueDate: t.dueDate()?.toString() || "None"})), null, 2);'

# Show Today list
osascript scripts/url.js show id=today
```

### Create Weekly Review Project

```bash
data='[{
  "type": "project",
  "attributes": {
    "title": "Weekly Review - Week of '"$(date +%Y-%m-%d)"'",
    "when": "today",
    "tags": ["Review"],
    "items": [
      {"type": "heading", "attributes": {"title": "Review"}},
      {"type": "to-do", "attributes": {"title": "Review completed tasks"}},
      {"type": "to-do", "attributes": {"title": "Review project progress"}},
      {"type": "to-do", "attributes": {"title": "Clear inbox"}},
      {"type": "heading", "attributes": {"title": "Plan"}},
      {"type": "to-do", "attributes": {"title": "Set goals for next week"}},
      {"type": "to-do", "attributes": {"title": "Schedule important tasks"}},
      {"type": "heading", "attributes": {"title": "Organize"}},
      {"type": "to-do", "attributes": {"title": "Archive completed projects"}},
      {"type": "to-do", "attributes": {"title": "Update areas and tags"}}
    ]
  }
}]'
open "things:///json?data=$(echo "$data" | jq -sRr @uri)"
```

### Bulk Tag All Inbox Items

```bash
todo_ids=$(scripts/run-jxa.sh 'const app = Application("Things3"); JSON.stringify(app.lists.byId("TMInboxListSource").toDos().map(t => t.id()));' | jq -r '.[]')

for todo_id in $todo_ids; do
  osascript scripts/url.js update id="$todo_id" add-tags="Needs Review"
  sleep 0.1
done
```

### Export Todos to Markdown

```bash
osascript -l JavaScript -e '
const app = Application("Things3");
const today = app.lists.byId("TMTodayListSource");
const todos = today.toDos();

let markdown = "# Today\\'s Tasks\n\n";
todos.forEach(todo => {
  const status = todo.status().toString();
  const checkbox = status === "completed" ? "[x]" : "[ ]";
  markdown += `${checkbox} ${todo.name()}\n`;
  if (todo.notes()) {
    markdown += `  ${todo.notes()}\n`;
  }
});

markdown;
' > today.md
```

## Linking Tasks

### Create Follow-up with Link to Original

```bash
original_id="ABC-123"
osascript scripts/url.js add title="Follow up: Review proposal" notes="Original task: things:///show?id=$original_id" when=tomorrow
```

### Link Related Tasks in Notes

```bash
related_id="DEF-456"
osascript scripts/url.js update id=ABC-123 append-notes="Related: things:///show?id=$related_id"
```

## Logbook Queries

The logbook contains completed/canceled tasks sorted by completion date (most recent first). Unlike Inbox/Today (tens of items) or Anytime/Upcoming/Someday (up to hundreds), the logbook can contain thousands to tens of thousands of items accumulated over years.

**Performance characteristics:**
- `properties()` batching: ~70-80ms per item
- Full scan of 10k items: ~15-20 minutes
- Date-range queries are efficient due to sort order

### Recent Completions (Last Week)

Scan from index 0 and stop when items are older than the target date:

```bash
osascript -l JavaScript -e '
const app = Application("Things3");
const logbook = app.lists.byId("TMLogbookListSource");
const todos = logbook.toDos();

const oneWeekAgo = new Date();
oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

const result = [];
for (let i = 0; i < todos.length; i++) {
  const p = todos[i].properties();
  if (!p.completionDate || p.completionDate < oneWeekAgo) break;
  result.push({
    id: p.id,
    name: p.name,
    completionDate: p.completionDate,
    status: p.status
  });
}

JSON.stringify(result, null, 2);
'
```

### Completions in Date Range

```bash
osascript -l JavaScript -e '
const app = Application("Things3");
const logbook = app.lists.byId("TMLogbookListSource");
const todos = logbook.toDos();

const startDate = new Date("2025-12-01");
const endDate = new Date("2025-12-31");

const result = [];
for (let i = 0; i < todos.length; i++) {
  const p = todos[i].properties();
  if (!p.completionDate) continue;
  if (p.completionDate > endDate) continue;  // Skip newer items
  if (p.completionDate < startDate) break;   // Stop at older items
  result.push({
    id: p.id,
    name: p.name,
    completionDate: p.completionDate
  });
}

JSON.stringify({count: result.length, items: result}, null, 2);
'
```

### Count Items Per Month

For analytics across the full logbook (expect ~15-20 min for large databases):

```bash
osascript -l JavaScript -e '
const app = Application("Things3");
const logbook = app.lists.byId("TMLogbookListSource");
const todos = logbook.toDos();

const counts = {};
for (let i = 0; i < todos.length; i++) {
  const p = todos[i].properties();
  if (!p.completionDate) continue;
  const month = p.completionDate.toISOString().slice(0, 7);
  counts[month] = (counts[month] || 0) + 1;
}

JSON.stringify(counts, null, 2);
'
```
