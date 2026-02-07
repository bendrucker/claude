#!/usr/bin/env osascript -l JavaScript

function run(argv) {
  var startIso = argv[0];
  var endIso = argv[1];

  if (!startIso || !endIso) {
    return JSON.stringify({ error: "Usage: query-logbook.js <start-iso> <end-iso>" });
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
    var project = todo.project();
    items.push({
      id: p.id,
      name: p.name,
      completionDate: p.completionDate.toISOString(),
      status: p.status,
      project: project ? project.name() : null,
    });
  }

  return JSON.stringify({ count: items.length, items: items });
}
