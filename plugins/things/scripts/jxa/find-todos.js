#!/usr/bin/env osascript -l JavaScript

function run(argv) {
  var mode = argv[0];
  var value = argv[1];
  var includeLogbook = argv[2] === "--logbook";

  if (!mode || !value) {
    return JSON.stringify({ error: "Usage: find-todos.js <tag|project> <value> [--logbook]" });
  }

  var app = Application("Things3");

  if (mode === "tag") {
    var tags = app.tags.whose({ name: value });
    if (tags.length === 0) {
      return JSON.stringify({ error: "Tag not found: " + value });
    }

    var listIds = [
      "TMInboxListSource",
      "TMTodayListSource",
      "TMNextListSource",
      "TMCalendarListSource",
      "TMSomedayListSource",
    ];
    if (includeLogbook) {
      listIds.push("TMLogbookListSource");
    }

    var items = [];
    for (var li = 0; li < listIds.length; li++) {
      var todos = app.lists.byId(listIds[li]).toDos.whose({ tagNames: { _contains: value } })();
      for (var i = 0; i < todos.length; i++) {
        var t = todos[i];
        var project = t.project();
        items.push({
          id: t.id(),
          name: t.name(),
          status: t.status().toString(),
          project: project ? project.name() : null,
        });
      }
    }
    return JSON.stringify(items);
  }

  if (mode === "project") {
    var projects = app.projects.whose({ name: value });
    if (projects.length === 0) {
      return JSON.stringify({ error: "Project not found: " + value });
    }
    var proj = projects[0];
    var todos = proj.toDos();
    var items = [];
    for (var i = 0; i < todos.length; i++) {
      var t = todos[i];
      items.push({
        id: t.id(),
        name: t.name(),
        status: t.status().toString(),
        notes: t.notes() || "",
      });
    }
    return JSON.stringify(items);
  }

  return JSON.stringify({ error: "Unknown mode: " + mode + ". Use 'tag' or 'project'." });
}
