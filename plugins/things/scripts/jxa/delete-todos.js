#!/usr/bin/env osascript -l JavaScript

// Moves todos to the Trash, which is what Things' scripting `delete` does. Every
// id resolves before the first delete, so an unknown id fails the call with
// nothing deleted.

function run(argv) {
  if (argv.length === 0) {
    return JSON.stringify({ error: "Usage: delete-todos.js <id> [id...]" });
  }

  var app = Application("Things3");
  var todos = [];
  var missing = [];

  for (var i = 0; i < argv.length; i++) {
    var todo = app.toDos.byId(argv[i]);
    try {
      todo.id();
      todos.push(todo);
    } catch (error) {
      missing.push(argv[i]);
    }
  }

  if (missing.length > 0) {
    return JSON.stringify({ error: "Todo not found: " + missing.join(", ") });
  }

  for (var j = 0; j < todos.length; j++) {
    app.delete(todos[j]);
  }

  return JSON.stringify(argv);
}
