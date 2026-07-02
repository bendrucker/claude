#!/usr/bin/env osascript -l JavaScript

function run(argv) {
  var startIso = argv[0];
  var endIso = argv[1];
  var notesContains = null;
  if (argv[2] === "--notes-contains") {
    notesContains = argv[3];
  }

  if (!startIso || !endIso || (argv.length > 2 && !notesContains)) {
    return JSON.stringify({
      error: "Usage: query-logbook.js <start-iso> <end-iso> [--notes-contains <substring>]",
    });
  }

  var startDate = new Date(startIso);
  var endDate = new Date(endIso);
  var app = Application("Things3");
  var logbook = app.lists.byId("TMLogbookListSource");
  var todos = logbook.toDos();

  var items = [];
  for (var i = 0; i < todos.length; i++) {
    var todo = todos[i];
    var p = todo.properties();
    if (!p.completionDate) continue;
    if (p.completionDate > endDate) continue;
    if (p.completionDate < startDate) break;
    if (notesContains !== null && (p.notes || "").indexOf(notesContains) === -1) continue;
    var project = todo.project();
    var item = {
      id: p.id,
      name: p.name,
      completionDate: p.completionDate.toISOString(),
      status: p.status,
      project: project ? project.name() : null,
    };
    if (notesContains !== null) {
      item.notes = p.notes || "";
    }
    items.push(item);
  }

  return JSON.stringify({ count: items.length, items: items });
}
