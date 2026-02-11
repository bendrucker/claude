#!/usr/bin/env osascript -l JavaScript

function run(argv) {
  var app = Application("Reminders");
  var list = app.defaultList();
  var deleted = 0;

  for (var i = argv.length - 1; i >= 0; i--) {
    var targetId = argv[i];
    var reminders = list.reminders();
    for (var j = reminders.length - 1; j >= 0; j--) {
      if (reminders[j].id() === targetId) {
        app.delete(reminders[j]);
        deleted++;
        break;
      }
    }
  }

  return JSON.stringify({ deleted: deleted });
}
