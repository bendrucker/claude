#!/usr/bin/env osascript -l JavaScript

function run(argv) {
  var type = argv[0];
  if (!type) {
    return JSON.stringify({ error: "Usage: query-metadata.js <projects|areas|tags>" });
  }

  var app = Application("Things3");
  var result = [];

  if (type === "projects") {
    var projects = app.projects();
    for (var i = 0; i < projects.length; i++) {
      var p = projects[i];
      var area = p.area();
      result.push({
        id: p.id(),
        name: p.name(),
        area: area ? area.name() : null,
        status: p.status().toString(),
        todoCount: p.toDos().length,
      });
    }
  } else if (type === "areas") {
    var areas = app.areas();
    for (var i = 0; i < areas.length; i++) {
      var a = areas[i];
      result.push({
        id: a.id(),
        name: a.name(),
        todoCount: a.toDos().length,
        tags: a.tagNames(),
      });
    }
  } else if (type === "tags") {
    var tags = app.tags();
    for (var i = 0; i < tags.length; i++) {
      var tag = tags[i];
      var parent = tag.parentTag();
      result.push({
        id: tag.id(),
        name: tag.name(),
        parent: parent ? parent.name() : null,
      });
    }
  } else {
    return JSON.stringify({ error: "Invalid type: " + type + ". Use: projects, areas, or tags" });
  }

  return JSON.stringify(result);
}
