#!/usr/bin/env osascript -l JavaScript
// @ts-check
/// <reference path="../../../src/jxa-globals.d.ts" />

/**
 * Query todos from a Things built-in list
 * Usage: osascript scripts/query-list.js <list-id>
 *
 * List IDs: TMInboxListSource, TMTodayListSource, TMNextListSource,
 *           TMCalendarListSource, TMSomedayListSource, TMLogbookListSource
 */

/**
 * @param {string[]} argv
 */
function run(argv) {
  const listId = argv[0];
  if (!listId) {
    console.log("Usage: osascript scripts/query-list.js <list-id>");
    console.log("List IDs: TMInboxListSource, TMTodayListSource, TMNextListSource,");
    console.log("          TMCalendarListSource, TMSomedayListSource, TMLogbookListSource");
    return JSON.stringify({ error: "No list ID provided" });
  }

  const app = Application("Things3");
  const list = app.lists.byId(listId);
  const items = list.toDos();
  const result = [];

  for (let i = 0; i < items.length; i++) {
    const t = items[i];
    const props = t.properties();
    const project = t.project();
    const area = t.area();
    result.push({
      id: props.id,
      name: props.name,
      notes: props.notes || "",
      status: props.status,
      dueDate: props.dueDate ? props.dueDate.toISOString() : null,
      activationDate: props.activationDate ? props.activationDate.toISOString() : null,
      tags: props.tagNames || "",
      project: project ? project.name() : null,
      area: area ? area.name() : null,
    });
  }

  return JSON.stringify(result, null, 2);
}
