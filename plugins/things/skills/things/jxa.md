# Things 3 AppleScript/JXA Reference

Complete documentation for Things 3 automation via AppleScript and JavaScript for Automation (JXA).

**Source**: Things3.sdef (AppleScript dictionary from Things.app)

**Extract sdef**:
```bash
sdef /Applications/Things3.app > Things3.sdef
```

## Table of Contents

- [Application Object](#application-object)
- [List Object](#list-object)
- [To Do Object](#to-do-object)
- [Project Object](#project-object)
- [Area Object](#area-object)
- [Tag Object](#tag-object)
- [Contact Object](#contact-object)
- [Status Enumeration](#status-enumeration)
- [Common Patterns](#common-patterns)
- [Detecting Repeating Tasks](#detecting-repeating-tasks)

---

## Overview

Things 3 provides full AppleScript support. Use JXA (JavaScript for Automation) for JSON-friendly output.

**Basic JXA Pattern:**
```bash
osascript -l JavaScript -e '
const app = Application("Things3");
// Your code here
'
```

---

## Application Object

The top-level scripting object representing the Things application.

**Properties:**
- `name` (text, read-only) - Application name
- `frontmost` (boolean, read-only) - Is frontmost application
- `version` (text, read-only) - Application version
- `currentListUrl` (text, read-only, hidden) - Current list URL
- `currentListName` (text, read-only, hidden) - Current list name

**Elements:**
- `windows` - Array of window objects
- `lists` - Array of list objects
- `toDos` - Array of all to-do objects
- `projects` - Array of project objects
- `areas` - Array of area objects
- `contacts` - Array of contact objects
- `tags` - Array of tag objects
- `selectedToDos` - Array of selected to-do objects

**Example:**
```javascript
const app = Application("Things3");
app.version(); // "3.20.1"
app.lists().length; // Number of lists
```

---

## List Object

Represents a Things list (Inbox, Today, Anytime, etc.).

**Properties:**
- `id` (text, read-only) - Unique identifier
- `name` (text, read-write) - List name

**Elements:**
- `toDos` - Array of to-do objects in the list

**Methods:**
- `show()` - Show list in Things UI

**Built-in List IDs:**
- `TMInboxListSource` - Inbox
- `TMTodayListSource` - Today
- `TMNextListSource` - Anytime
- `TMCalendarListSource` - Upcoming
- `TMSomedayListSource` - Someday
- `TMLogbookListSource` - Logbook

**Example:**
```javascript
const app = Application("Things3");
const today = app.lists.byId("TMTodayListSource");
today.name(); // "Today"
today.toDos().length; // Number of todos in Today

// Show the list
today.show();
```

**Querying Lists:**
```javascript
// Get all lists
const allLists = app.lists();

// Get list by name
const inbox = app.lists.whose({name: "Inbox"})[0];

// Get list by ID
const today = app.lists.byId("TMTodayListSource");
```

---

## To Do Object

Represents a Things to-do item.

**Properties:**
- `id` (text, read-only) - Unique identifier
- `name` (text, read-write) - Todo title
- `notes` (text, read-write) - Todo notes
- `creationDate` (date, read-write) - Creation date
- `modificationDate` (date, read-write) - Modification date
- `dueDate` (date, read-write) - Due date
- `activationDate` (date, read-only) - Scheduled start date
- `completionDate` (date, read-write) - Completion date
- `cancellationDate` (date, read-write) - Cancellation date
- `status` (status enum, read-write) - Todo status (open/completed/canceled)
- `tagNames` (text, read-write) - Comma-separated tag names
- `project` (project object) - Parent project
- `area` (area object) - Parent area
- `contact` (contact object) - Assigned contact

**Elements:**
- `tags` - Array of tag objects

**Methods:**
- `show()` - Show in Things UI
- `edit()` - Open edit dialog
- `move(to: list)` - Move to different list
- `schedule(for: date)` - Schedule for specific date

**Example:**
```javascript
const app = Application("Things3");
const inbox = app.lists.byId("TMInboxListSource");
const todos = inbox.toDos().map(todo => ({
  id: todo.id(),
  name: todo.name(),
  notes: todo.notes(),
  dueDate: todo.dueDate()?.toString(),
  status: todo.status().toString(),
  tags: todo.tagNames(),
  project: todo.project()?.name(),
  area: todo.area()?.name()
}));
JSON.stringify(todos, null, 2);
```

**Querying Todos:**
```javascript
// Get all todos
const allTodos = app.toDos();

// Get todo by name
const todo = app.toDos.whose({name: "Buy milk"})[0];

// Get todo by ID
const todo = app.toDos.byId("ABC-123");

// Filter by status
const openTodos = today.toDos().filter(todo =>
  todo.status().toString() === "open"
);

// Get todos with specific tag
const workTodos = app.toDos().filter(todo =>
  todo.tagNames().includes("Work")
);
```

**Modifying Todos:**
```javascript
const app = Application("Things3");
const todo = app.toDos.byId("ABC-123");

// Change title
todo.name = "New title";

// Add notes (append)
todo.notes = todo.notes() + "\nAdditional info";

// Change due date
todo.dueDate = new Date("2025-12-31");

// Change status
todo.status = "completed";

// Move to different list
const anytime = app.lists.byId("TMNextListSource");
todo.move({to: anytime});

// Schedule for specific date
todo.schedule({for: new Date("2025-11-01")});

// Show in UI
todo.show();

// Open edit dialog
todo.edit();
```

---

## Project Object

Inherits from To Do with additional elements.

**All To Do properties plus:**

**Additional Elements:**
- `toDos` - Array of to-do objects within the project

**Example:**
```javascript
const app = Application("Things3");
const projects = app.projects();

projects.forEach(project => {
  const todoCount = project.toDos().length;
  const status = project.status().toString();
  console.log(`${project.name()}: ${todoCount} todos (${status})`);
});
```

**Get Project Todos:**
```javascript
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
}
```

---

## Area Object

Inherits from List. Represents a Things area of responsibility.

**All List properties plus:**

**Properties:**
- `tagNames` (text, read-write) - Comma-separated tag names
- `collapsed` (boolean, read-write) - Is area collapsed in UI

**Elements:**
- `toDos` - Array of to-do objects in the area
- `tags` - Array of tag objects

**Example:**
```javascript
const app = Application("Things3");
const areas = app.areas().map(area => ({
  id: area.id(),
  name: area.name(),
  collapsed: area.collapsed(),
  todoCount: area.toDos().length,
  tags: area.tagNames()
}));
JSON.stringify(areas, null, 2);
```

**Querying Areas:**
```javascript
// Get all areas
const allAreas = app.areas();

// Get area by name
const home = app.areas.whose({name: "Home"})[0];

// Get todos in area
if (home) {
  const todos = home.toDos();
}
```

---

## Tag Object

Represents a Things tag.

**Properties:**
- `id` (text, read-only) - Unique identifier
- `name` (text, read-write) - Tag name
- `keyboardShortcut` (text, read-write) - Keyboard shortcut
- `parentTag` (tag object) - Parent tag (for nested tags)

**Elements:**
- `tags` - Array of child tag objects (for nested tags)
- `toDos` - Array of to-do objects with this tag

**Example:**
```javascript
const app = Application("Things3");
const tags = app.tags().map(tag => ({
  id: tag.id(),
  name: tag.name(),
  parent: tag.parentTag()?.name(),
  shortcut: tag.keyboardShortcut(),
  todoCount: tag.toDos().length
}));
JSON.stringify(tags, null, 2);
```

**Querying Tags:**
```javascript
// Get all tags
const allTags = app.tags();

// Get tag by name
const work = app.tags.whose({name: "Work"})[0];

// Get todos with tag
if (work) {
  const todos = work.toDos().map(todo => ({
    id: todo.id(),
    name: todo.name()
  }));
}

// Get nested tags
const parent = app.tags.whose({name: "Projects"})[0];
if (parent) {
  const children = parent.tags(); // Child tags
}
```

---

## Contact Object

Inherits from List. Represents a Things contact.

**Elements:**
- `toDos` - Array of to-do objects assigned to this contact

**Example:**
```javascript
const app = Application("Things3");
const contacts = app.contacts().map(contact => ({
  id: contact.id(),
  name: contact.name(),
  todoCount: contact.toDos().length
}));
JSON.stringify(contacts, null, 2);
```

---

## Status Enumeration

Represents the status of a to-do or project.

**Values:**
- `open` - To-do is open/active
- `completed` - To-do has been completed
- `canceled` - To-do has been canceled

**Example:**
```javascript
const app = Application("Things3");
const today = app.lists.byId("TMTodayListSource");

today.toDos().forEach(todo => {
  const status = todo.status();
  // status is an enum, convert to string for comparison:
  const statusStr = status.toString();

  if (statusStr === "open") {
    console.log(`Open: ${todo.name()}`);
  } else if (statusStr === "completed") {
    console.log(`Completed: ${todo.name()}`);
  }
});
```

**Setting Status:**
```javascript
const todo = app.toDos.byId("ABC-123");

// Mark complete
todo.status = "completed";

// Mark open
todo.status = "open";

// Mark canceled
todo.status = "canceled";
```

---

## Common Patterns

### Safely Handle Optional Values

Many properties can be null/undefined. Use optional chaining:

```javascript
const todo = app.toDos.byId("ABC-123");

// Safe access
const projectName = todo.project()?.name(); // undefined if no project
const dueDate = todo.dueDate()?.toString(); // undefined if no due date
```

### Query with Filters

Use `whose` for filtering and array indexing:

```javascript
// Get first match
const todo = app.toDos.whose({name: "Buy milk"})[0];

// Check if exists
if (todo) {
  console.log("Found:", todo.id());
} else {
  console.log("Not found");
}

// Get all matches (whose returns an array)
const workTodos = app.toDos.whose({tagNames: "Work"});
```

### Iterate with Map

Map todos to JSON-friendly objects:

```javascript
const todos = app.lists.byId("TMTodayListSource")
  .toDos()
  .map(todo => ({
    id: todo.id(),
    name: todo.name(),
    project: todo.project()?.name(),
    status: todo.status().toString()
  }));

JSON.stringify(todos, null, 2);
```

### Filter Arrays

Use standard JavaScript array methods:

```javascript
const todos = today.toDos();

// Filter open todos
const openTodos = todos.filter(todo =>
  todo.status().toString() === "open"
);

// Filter by due date
const overdue = todos.filter(todo => {
  const due = todo.dueDate();
  return due && due < new Date();
});
```

### Handle Dates

Dates require conversion to/from JavaScript Date objects:

```javascript
// Read date
const dueDate = todo.dueDate();
if (dueDate) {
  console.log(dueDate.toString());
  console.log(dueDate.toISOString());
}

// Set date
todo.dueDate = new Date("2025-12-31");
todo.dueDate = new Date(); // Today

// Clear date
todo.dueDate = null;
```

### Batch Operations

Process multiple todos efficiently:

```javascript
const app = Application("Things3");
const inbox = app.lists.byId("TMInboxListSource");

// Tag all inbox items
inbox.toDos().forEach(todo => {
  todo.tagNames = todo.tagNames() + ",Needs Review";
});

// Move all to Anytime
const anytime = app.lists.byId("TMNextListSource");
inbox.toDos().forEach(todo => {
  todo.move({to: anytime});
});
```

### Error Handling

Wrap queries in try-catch for safety:

```javascript
try {
  const app = Application("Things3");
  const todo = app.toDos.whose({name: "Task name"})[0];

  if (!todo) {
    console.log(JSON.stringify({error: "Todo not found"}));
  } else {
    console.log(JSON.stringify({
      id: todo.id(),
      name: todo.name()
    }));
  }
} catch (error) {
  console.log(JSON.stringify({error: error.message}));
}
```

### Complete Example Script

```javascript
const app = Application("Things3");

// Get all open todos from Today
const today = app.lists.byId("TMTodayListSource");
const openTodos = today.toDos()
  .filter(todo => todo.status().toString() === "open")
  .map(todo => {
    const project = todo.project();
    const area = todo.area();
    const due = todo.dueDate();

    return {
      id: todo.id(),
      name: todo.name(),
      notes: todo.notes() || "",
      project: project ? project.name() : null,
      area: area ? area.name() : null,
      dueDate: due ? due.toISOString() : null,
      tags: todo.tagNames().split(",").filter(t => t)
    };
  });

JSON.stringify({
  count: openTodos.length,
  todos: openTodos
}, null, 2);
```

---

## Detecting Repeating Tasks

Things does not expose repeating task configuration through JXA. However, repeating task instances can be reliably detected using a simple heuristic.

### Detection Rule

**A task is a repeating instance if `creationDate` is at midnight local time (00:00:00 in the local timezone).**

When Things auto-generates a task from a repeating template, it sets the `creationDate` to midnight on the day the task is created. This is the reliable indicator that distinguishes repeating instances from manually created tasks, which have creation timestamps reflecting the actual time they were created.

### How Repeating Tasks Work

When a repeating task generates a new instance:
1. Things creates a new todo with the same name as the template
2. The new instance has `creationDate` set to midnight (00:00:00) in local time
3. Manually created tasks have `creationDate` timestamps with non-zero hours/minutes/seconds
4. The original template remains elsewhere with `activationDate: null`

**Example:**
```javascript
const app = Application("Things3");
const today = app.lists.byId("TMTodayListSource");

// Check if a task is a repeating instance
const todo = today.toDos()[0];
const props = todo.properties();

const isRepeatingInstance = props.creationDate &&
  props.creationDate.getHours() === 0 &&
  props.creationDate.getMinutes() === 0 &&
  props.creationDate.getSeconds() === 0;

if (isRepeatingInstance) {
  console.log(`${props.name} is a repeating task instance`);
}
```

### Finding Repeating Templates

Templates are todos with `activationDate: null`:

```javascript
const app = Application("Things3");

// Get all repeating templates
const templates = app.toDos()
  .filter(todo => {
    const props = todo.properties();
    return props.activationDate === null && props.status === "open";
  })
  .map(todo => {
    const props = todo.properties();
    return {
      id: props.id,
      name: props.name,
      creationDate: props.creationDate
    };
  });

JSON.stringify(templates, null, 2);
```

### Matching Instances to Templates

To confirm a task is repeating, find its template:

```javascript
const app = Application("Things3");

function findRepeatingTemplate(taskName) {
  return app.toDos()
    .filter(todo => {
      const props = todo.properties();
      return props.name === taskName &&
             props.activationDate === null &&
             props.status === "open";
    })[0];
}

// Check if today's task is repeating
const today = app.lists.byId("TMTodayListSource");
const task = today.toDos()[0];
const taskProps = task.properties();

const template = findRepeatingTemplate(taskProps.name);

if (template) {
  console.log(`${taskProps.name} is a repeating task`);
  console.log(`Template ID: ${template.id()}`);
}
```

### Filtering Out Repeating Tasks

Exclude repeating instances from processing:

```javascript
const app = Application("Things3");
const today = app.lists.byId("TMTodayListSource");

const nonRepeatingTasks = today.toDos()
  .filter(todo => {
    const props = todo.properties();

    // Keep tasks with missing dates
    if (!props.creationDate) return true;

    // Filter out repeating instances (created at midnight)
    return props.creationDate.getHours() !== 0 ||
           props.creationDate.getMinutes() !== 0 ||
           props.creationDate.getSeconds() !== 0;
  })
  .map(todo => ({
    id: todo.id(),
    name: todo.name()
  }));

JSON.stringify(nonRepeatingTasks, null, 2);
```

### Key Insights

- **Repeating instance**: `creationDate` is at midnight (00:00:00 local time)
- **Manual task**: `creationDate` has non-zero hours/minutes/seconds
- **Template Signature**: `activationDate: null` (templates are not scheduled)
- **No Direct Link**: Things doesn't expose template-to-instance relationships via JXA
- **Name Matching**: Templates and instances share the same `name`
