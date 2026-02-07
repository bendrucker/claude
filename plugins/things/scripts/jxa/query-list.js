#!/usr/bin/env osascript -l JavaScript

function run(argv) {
  var listId = argv[0];
  if (!listId) {
    return JSON.stringify({ error: "Usage: query-list.js <list-id>" });
  }

  var app = Application("Things3");
  var list = app.lists.byId(listId);
  var todos = list.toDos();
  var result = [];

  for (var i = 0; i < todos.length; i++) {
    var t = todos[i];
    var props = t.properties();
    var project = t.project();
    var area = t.area();
    result.push({
      id: props.id,
      name: props.name,
      notes: props.notes || "",
      status: props.status,
      dueDate: props.dueDate ? props.dueDate.toISOString() : null,
      activationDate: props.activationDate ? props.activationDate.toISOString() : null,
      tags: props.tagNames || "",
      project: project ? project.name() : null,
      area: area ? area.name() : null,
      creationDate: props.creationDate ? props.creationDate.toISOString() : null,
    });
  }

  return JSON.stringify(result);
}
