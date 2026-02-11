#!/usr/bin/env osascript -l JavaScript

function run(argv) {
  var app = Application("Reminders");
  var list = app.defaultList();
  var reminders = list.reminders.whose({ completed: false })();
  var items = [];
  for (var i = 0; i < reminders.length; i++) {
    var r = reminders[i];
    items.push({
      id: r.id(),
      name: r.name(),
      body: r.body() || "",
      dueDate: r.dueDate() ? r.dueDate().toISOString() : null,
      priority: r.priority(),
      flagged: r.flagged(),
      creationDate: r.creationDate().toISOString(),
    });
  }
  return JSON.stringify(items);
}
