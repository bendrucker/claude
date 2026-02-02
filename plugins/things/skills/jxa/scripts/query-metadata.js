#!/usr/bin/env osascript -l JavaScript
// @ts-check
/// <reference path="../../../src/jxa-globals.d.ts" />

/**
 * List Things projects, areas, or tags
 * Usage: osascript scripts/query-metadata.js projects|areas|tags
 */

/**
 * @param {string[]} argv
 */
function run(argv) {
  const type = argv[0];
  if (!type || !["projects", "areas", "tags"].includes(type)) {
    console.log("Usage: osascript scripts/query-metadata.js projects|areas|tags");
    return JSON.stringify({ error: "Invalid type. Use: projects, areas, or tags" });
  }

  const app = Application("Things3");

  const result = [];

  if (type === "projects") {
    const items = app.projects();
    for (let i = 0; i < items.length; i++) {
      const p = items[i];
      const area = p.area();
      result.push({
        id: p.id(),
        name: p.name(),
        area: area ? area.name() : null,
        status: p.status().toString(),
        todoCount: p.toDos().length,
      });
    }
  } else if (type === "areas") {
    const items = app.areas();
    for (let i = 0; i < items.length; i++) {
      const a = items[i];
      result.push({
        id: a.id(),
        name: a.name(),
        collapsed: a.collapsed(),
        todoCount: a.toDos().length,
        tags: a.tagNames(),
      });
    }
  } else if (type === "tags") {
    const items = app.tags();
    for (let i = 0; i < items.length; i++) {
      const tag = items[i];
      const parent = tag.parentTag();
      result.push({
        id: tag.id(),
        name: tag.name(),
        parent: parent ? parent.name() : null,
        shortcut: tag.keyboardShortcut(),
        todoCount: tag.toDos().length,
      });
    }
  }

  return JSON.stringify(result, null, 2);
}
