#!/usr/bin/env osascript -l JavaScript

// Notes are the bulk of a list read: measured over the logbook they ran 61% of
// the payload, median 223 characters and up to 3552. A list view needs enough
// to recognize a todo, so it carries a preview and get-todo.js serves the rest.
var NOTES_PREVIEW_CHARS = 120;

function run(argv) {
  var listId = argv[0];
  var limit = 0;
  for (var a = 1; a < argv.length; a++) {
    if (argv[a] === "--limit") {
      limit = parseInt(argv[a + 1], 10);
      a++;
    }
  }
  if (!listId) {
    return JSON.stringify({ error: "Usage: query-list.js <list-id> [--limit <n>]" });
  }

  var app = Application("Things3");
  var list = app.lists.byId(listId);
  var todos = list.toDos();
  var result = [];

  // The limit stops the loop rather than slicing afterwards. Each iteration
  // costs three Apple Events, so bounding the walk is what makes a large list
  // affordable.
  var truncated = false;
  for (var i = 0; i < todos.length; i++) {
    if (limit > 0 && result.length >= limit) {
      truncated = true;
      break;
    }
    var t = todos[i];
    var props = t.properties();
    var project = t.project();
    var area = t.area();
    var notes = props.notes || "";
    result.push({
      id: props.id,
      name: props.name,
      notesPreview: notes.substring(0, NOTES_PREVIEW_CHARS),
      hasMoreNotes: notes.length > NOTES_PREVIEW_CHARS,
      status: props.status,
      dueDate: props.dueDate ? props.dueDate.toISOString() : null,
      activationDate: props.activationDate ? props.activationDate.toISOString() : null,
      tags: props.tagNames || "",
      project: project ? project.name() : null,
      area: area ? area.name() : null,
      creationDate: props.creationDate ? props.creationDate.toISOString() : null,
    });
  }

  return JSON.stringify({
    count: result.length,
    truncatedByLimit: truncated,
    items: result,
  });
}
