# Things 3 Usage Examples

Practical examples for common Things automation tasks.

## Creating Todos

### Simple Todo

```bash
open "things:///add?title=Call%20dentist&when=today"
```

### Todo with Full Details

```bash
open "things:///add?title=Quarterly%20Review&notes=Review%20goals%20and%20metrics&when=2025-11-01&deadline=2025-11-07&tags=Work,Planning"
```

### Multiple Todos at Once

```bash
open "things:///add?titles=Buy%20milk%0aPick%20up%20dry%20cleaning%0aWalk%20dog&when=today"
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
open "things:///add?title=Write%20chapter%203&list=Book%20Writing&when=anytime"

# Or get project ID via JXA and use list-id
project_id=$(osascript -l JavaScript -e '
const app = Application("Things3");
const project = app.projects.whose({name: "Book Writing"})[0];
project ? project.id() : "";
')
open "things:///add?title=Write%20chapter%203&list-id=$project_id&when=anytime"
```

## Creating Projects

### Simple Project

```bash
open "things:///add-project?title=Website%20Redesign&when=today&tags=Work"
```

### Project with Todos

```bash
open "things:///add-project?title=Plan%20vacation&when=tomorrow&to-dos=Research%20destinations%0aBook%20flights%0aBook%20hotel%0aCreate%20itinerary"
```

### Project in Area

```bash
open "things:///add-project?title=Kitchen%20renovation&area=Home&when=someday"
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

### Append Notes

```bash
# First get the todo ID
todo_id=$(osascript -l JavaScript -e '
const app = Application("Things3");
const today = app.lists.byId("TMTodayListSource");
const todo = today.toDos().whose({name: "Call dentist"})[0];
todo ? todo.id() : "";
')

# Then update with auth token
auth_token="YOUR_AUTH_TOKEN"
open "things:///update?id=$todo_id&auth-token=$auth_token&append-notes=Appointment%20at%202pm"
```

### Add Tags

```bash
todo_id="ABC-123"
auth_token="YOUR_AUTH_TOKEN"
open "things:///update?id=$todo_id&auth-token=$auth_token&add-tags=Urgent,Important"
```

### Move to Different Project

```bash
todo_id="ABC-123"
auth_token="YOUR_AUTH_TOKEN"
open "things:///update?id=$todo_id&auth-token=$auth_token&list=New%20Project"
```

### Reschedule Todo

```bash
todo_id="ABC-123"
auth_token="YOUR_AUTH_TOKEN"
open "things:///update?id=$todo_id&auth-token=$auth_token&when=tomorrow"
```

### Mark Complete

```bash
todo_id="ABC-123"
auth_token="YOUR_AUTH_TOKEN"
open "things:///update?id=$todo_id&auth-token=$auth_token&completed=true"
```

### Add Checklist Items

```bash
todo_id="ABC-123"
auth_token="YOUR_AUTH_TOKEN"
open "things:///update?id=$todo_id&auth-token=$auth_token&append-checklist-items=New%20item%201%0aNew%20item%202"
```

## Navigation

### Show Built-in Lists

```bash
# Show Today
open "things:///show?id=today"

# Show Inbox
open "things:///show?id=inbox"

# Show Upcoming
open "things:///show?id=upcoming"

# Show Anytime
open "things:///show?id=anytime"
```

### Show Specific Todo

```bash
todo_id="ABC-123"
open "things:///show?id=$todo_id"
```

### Show Project

```bash
project_id=$(osascript -l JavaScript -e '
const app = Application("Things3");
const project = app.projects.whose({name: "Website Redesign"})[0];
project ? project.id() : "";
')
open "things:///show?id=$project_id"
```

### Search

```bash
open "things:///search?query=meeting%20notes"
```

## Advanced Workflows

### Daily Planning Script

```bash
#!/bin/bash

# Get today's todos
echo "Today's Todos:"
osascript -l JavaScript -e '
const app = Application("Things3");
const today = app.lists.byId("TMTodayListSource");
const todos = today.toDos().map(todo => ({
  name: todo.name(),
  project: todo.project()?.name() || "None",
  dueDate: todo.dueDate()?.toString() || "None"
}));
console.log(JSON.stringify(todos, null, 2));
'

# Show Today list
open "things:///show?id=today"
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
auth_token="YOUR_AUTH_TOKEN"

# Get all inbox todo IDs
todo_ids=$(osascript -l JavaScript -e '
const app = Application("Things3");
const inbox = app.lists.byId("TMInboxListSource");
const ids = inbox.toDos().map(todo => todo.id());
JSON.stringify(ids);
' | jq -r '.[]')

# Tag each one
for todo_id in $todo_ids; do
  open "things:///update?id=$todo_id&auth-token=$auth_token&add-tags=Needs%20Review"
  sleep 0.1  # Rate limiting
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
