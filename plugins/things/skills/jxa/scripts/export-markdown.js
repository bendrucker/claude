#!/usr/bin/env osascript -l JavaScript
// @ts-check
/// <reference path="../../../src/jxa-globals.d.ts" />

/**
 * Export a Things list to markdown
 * Usage: osascript scripts/export-markdown.js [list-id]
 *
 * Default list: TMTodayListSource (Today)
 */

/**
 * @param {string[]} argv
 */
function run(argv) {
  const listId = argv[0] || "TMTodayListSource";

  const app = Application("Things3");
  const list = app.lists.byId(listId);
  const items = list.toDos();

  let markdown = "# " + list.name() + "\n\n";

  for (let i = 0; i < items.length; i++) {
    const t = items[i];
    const status = t.status().toString();
    const checkbox = status === "completed" ? "[x]" : "[ ]";
    markdown += "- " + checkbox + " " + t.name() + "\n";

    const notes = t.notes();
    if (notes) {
      const lines = notes.split("\n");
      for (let j = 0; j < lines.length; j++) {
        markdown += "  " + lines[j] + "\n";
      }
    }
  }

  return markdown;
}
