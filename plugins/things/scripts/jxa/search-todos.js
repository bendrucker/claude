#!/usr/bin/env osascript -l JavaScript

// Notes are the bulk of a list read, so enough to recognize a todo travels here
// and get-todo.js serves the rest on request.
var NOTES_PREVIEW_CHARS = 120;

function run(argv) {
  var text = argv[0];
  var field = "both";
  var limit = 0;
  for (var a = 1; a < argv.length; a++) {
    if (argv[a] === "--field") {
      field = argv[a + 1];
      a++;
    } else if (argv[a] === "--limit") {
      limit = parseInt(argv[a + 1], 10);
      a++;
    }
  }

  if (!text) {
    return JSON.stringify({
      error: "Usage: search-todos.js <text> [--field name|notes|both] [--limit <n>]",
    });
  }
  if (field !== "name" && field !== "notes" && field !== "both") {
    return JSON.stringify({ error: "Unknown field: " + field + ". Use name, notes, or both." });
  }

  var app = Application("Things3");

  // Name and notes are matched by two separate predicates rather than one `_or`,
  // which Things answers with an empty result instead of a union. Each predicate
  // runs inside Things, so the pair costs a fraction of a walk over every todo.
  var batches = [];
  if (field === "name" || field === "both") {
    batches.push(app.toDos.whose({ name: { _contains: text } })());
  }
  if (field === "notes" || field === "both") {
    batches.push(app.toDos.whose({ notes: { _contains: text } })());
  }

  var items = [];
  var ids = [];
  var truncated = false;
  for (var b = 0; b < batches.length && !truncated; b++) {
    var batch = batches[b];
    for (var i = 0; i < batch.length; i++) {
      if (limit > 0 && items.length >= limit) {
        truncated = true;
        break;
      }
      var todo = batch[i];
      var id = todo.id();
      // A todo matching on both fields arrives in both batches.
      if (ids.indexOf(id) !== -1) continue;
      ids.push(id);
      var project = todo.project();
      var notes = todo.notes() || "";
      items.push({
        id: id,
        name: todo.name(),
        notesPreview: notes.substring(0, NOTES_PREVIEW_CHARS),
        hasMoreNotes: notes.length > NOTES_PREVIEW_CHARS,
        status: todo.status().toString(),
        tags: todo.tagNames() || "",
        project: project ? project.name() : null,
      });
    }
  }

  return JSON.stringify({ count: items.length, truncatedByLimit: truncated, items: items });
}
