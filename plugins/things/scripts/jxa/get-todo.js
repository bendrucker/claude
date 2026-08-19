#!/usr/bin/env osascript -l JavaScript

// Full detail for one todo, the counterpart to the previews the list reads
// return. Checklist items are absent because Things' scripting dictionary has
// no accessor for them. The URL scheme can write a checklist, but nothing can
// read one back.

function run(argv) {
  var id = argv[0];
  if (!id) {
    return JSON.stringify({ error: "Usage: get-todo.js <id>" });
  }

  var app = Application("Things3");
  var todo;
  try {
    todo = app.toDos.byId(id);
    todo.id();
  } catch (error) {
    return JSON.stringify({ error: "Todo not found: " + id });
  }

  var props = todo.properties();
  var project = todo.project();
  var area = todo.area();

  return JSON.stringify({
    id: props.id,
    name: props.name,
    notes: props.notes || "",
    status: props.status,
    tags: props.tagNames || "",
    project: project ? project.name() : null,
    area: area ? area.name() : null,
    dueDate: props.dueDate ? props.dueDate.toISOString() : null,
    activationDate: props.activationDate ? props.activationDate.toISOString() : null,
    completionDate: props.completionDate ? props.completionDate.toISOString() : null,
    cancellationDate: props.cancellationDate ? props.cancellationDate.toISOString() : null,
    creationDate: props.creationDate ? props.creationDate.toISOString() : null,
    modificationDate: props.modificationDate ? props.modificationDate.toISOString() : null,
  });
}
