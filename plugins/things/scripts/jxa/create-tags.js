#!/usr/bin/env osascript -l JavaScript

function run(argv) {
  if (argv.length === 0) {
    return JSON.stringify({ error: "Usage: create-tags.js <name> [name...]" });
  }

  var app = Application("Things3");
  var created = [];

  for (var i = 0; i < argv.length; i++) {
    var name = argv[i];
    if (app.tags.whose({ name: name }).length > 0) continue;
    app.tags.push(app.Tag({ name: name }));
    created.push(name);
  }

  return JSON.stringify(created);
}
