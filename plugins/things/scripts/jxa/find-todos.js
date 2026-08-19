#!/usr/bin/env osascript -l JavaScript

// Notes are the bulk of a list read: over the logbook they ran 61% of the
// payload, median 223 characters and up to 3552. Enough to recognize a todo
// travels here, and get-todo.js serves the rest on request.
var NOTES_PREVIEW_CHARS = 120;

function run(argv) {
  var mode = argv[0];
  var value = argv[1];
  var includeLogbook = false;
  var limit = 0;
  for (var a = 2; a < argv.length; a++) {
    if (argv[a] === "--logbook") {
      includeLogbook = true;
    } else if (argv[a] === "--limit") {
      limit = parseInt(argv[a + 1], 10);
      a++;
    }
  }

  if (!mode || !value) {
    return JSON.stringify({
      error: "Usage: find-todos.js <tag|project|area> <value> [--logbook] [--limit <n>]",
    });
  }

  var app = Application("Things3");

  if (mode === "tag") {
    var tags = app.tags.whose({ name: value });
    if (tags.length === 0) {
      return JSON.stringify({ error: "Tag not found: " + value });
    }

    var lists = [
      ["TMInboxListSource", "inbox"],
      ["TMTodayListSource", "today"],
      ["TMNextListSource", "anytime"],
      ["TMCalendarListSource", "upcoming"],
      ["TMSomedayListSource", "someday"],
    ];
    if (includeLogbook) {
      lists.push(["TMLogbookListSource", "logbook"]);
    }

    var items = [];
    var truncated = false;
    for (var li = 0; li < lists.length && !truncated; li++) {
      var listId = lists[li][0];
      var listName = lists[li][1];
      var todos = app.lists.byId(listId).toDos.whose({ tagNames: { _contains: value } })();
      for (var i = 0; i < todos.length; i++) {
        if (limit > 0 && items.length >= limit) {
          truncated = true;
          break;
        }
        var t = todos[i];
        var project = t.project();
        var notes = t.notes() || "";
        items.push({
          id: t.id(),
          name: t.name(),
          notesPreview: notes.substring(0, NOTES_PREVIEW_CHARS),
          hasMoreNotes: notes.length > NOTES_PREVIEW_CHARS,
          status: t.status().toString(),
          tags: t.tagNames() || "",
          list: listName,
          project: project ? project.name() : null,
        });
      }
    }
    return JSON.stringify({ count: items.length, truncatedByLimit: truncated, items: items });
  }

  if (mode === "project") {
    var projects = app.projects.whose({ name: value });
    if (projects.length === 0) {
      return JSON.stringify({ error: "Project not found: " + value });
    }
    var proj = projects[0];
    var projectTodos = proj.toDos();
    var projectItems = [];
    var projectTruncated = false;
    for (var pi = 0; pi < projectTodos.length; pi++) {
      if (limit > 0 && projectItems.length >= limit) {
        projectTruncated = true;
        break;
      }
      var pt = projectTodos[pi];
      // A project holds its finished children alongside its open ones, so the
      // same flag that widens the tag search to the logbook widens this.
      var projectStatus = pt.status().toString();
      if (!includeLogbook && projectStatus !== "open") continue;
      var projectNotes = pt.notes() || "";
      projectItems.push({
        id: pt.id(),
        name: pt.name(),
        notesPreview: projectNotes.substring(0, NOTES_PREVIEW_CHARS),
        hasMoreNotes: projectNotes.length > NOTES_PREVIEW_CHARS,
        status: projectStatus,
        tags: pt.tagNames() || "",
      });
    }
    return JSON.stringify({
      count: projectItems.length,
      truncatedByLimit: projectTruncated,
      items: projectItems,
    });
  }

  if (mode === "area") {
    var areas = app.areas.whose({ name: value });
    if (areas.length === 0) {
      return JSON.stringify({ error: "Area not found: " + value });
    }
    // Only todos filed directly in the area. A todo inside one of the area's
    // projects belongs to that project, and find-todos.js project reaches it.
    var areaTodos = areas[0].toDos();
    var areaItems = [];
    var areaTruncated = false;
    for (var ai = 0; ai < areaTodos.length; ai++) {
      if (limit > 0 && areaItems.length >= limit) {
        areaTruncated = true;
        break;
      }
      var at = areaTodos[ai];
      var areaStatus = at.status().toString();
      if (!includeLogbook && areaStatus !== "open") continue;
      var areaNotes = at.notes() || "";
      var areaProject = at.project();
      areaItems.push({
        id: at.id(),
        name: at.name(),
        notesPreview: areaNotes.substring(0, NOTES_PREVIEW_CHARS),
        hasMoreNotes: areaNotes.length > NOTES_PREVIEW_CHARS,
        status: areaStatus,
        tags: at.tagNames() || "",
        project: areaProject ? areaProject.name() : null,
      });
    }
    return JSON.stringify({
      count: areaItems.length,
      truncatedByLimit: areaTruncated,
      items: areaItems,
    });
  }

  return JSON.stringify({ error: "Unknown mode: " + mode + ". Use 'tag', 'project', or 'area'." });
}
