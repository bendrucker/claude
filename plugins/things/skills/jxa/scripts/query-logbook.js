#!/usr/bin/env osascript -l JavaScript
// @ts-check
/// <reference path="../../../src/jxa-globals.d.ts" />

/**
 * Query Things logbook with date filtering
 * Usage: osascript scripts/query-logbook.js --days 7
 *        osascript scripts/query-logbook.js --start 2025-12-01 --end 2025-12-31
 *
 * The logbook is sorted by completion date (most recent first).
 * Scanning stops at the boundary, so recent queries are fast.
 */

/**
 * @param {string[]} argv
 */
function run(argv) {
  let days = null;
  let startDate = null;
  let endDate = null;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--days" && i + 1 < argv.length) {
      days = parseInt(argv[i + 1], 10);
      i++;
    } else if (argv[i] === "--start" && i + 1 < argv.length) {
      startDate = new Date(argv[i + 1]);
      i++;
    } else if (argv[i] === "--end" && i + 1 < argv.length) {
      endDate = new Date(argv[i + 1]);
      i++;
    }
  }

  if (days === null && startDate === null) {
    console.log("Usage: osascript scripts/query-logbook.js --days 7");
    console.log("       osascript scripts/query-logbook.js --start 2025-12-01 --end 2025-12-31");
    return JSON.stringify({ error: "Provide --days or --start/--end" });
  }

  if (days !== null) {
    startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    endDate = new Date();
  }

  if (!endDate) {
    endDate = new Date();
  }

  const app = Application("Things3");
  const logbook = app.lists.byId("TMLogbookListSource");
  const items = logbook.toDos();

  const result = [];
  for (let i = 0; i < items.length; i++) {
    const todo = items[i];
    const p = todo.properties();
    if (!p.completionDate) continue;
    if (p.completionDate > endDate) continue;
    if (p.completionDate < startDate) break;
    const project = todo.project();
    result.push({
      id: p.id,
      name: p.name,
      completionDate: p.completionDate,
      status: p.status,
      project: project ? project.name() : null,
    });
  }

  return JSON.stringify({ count: result.length, items: result }, null, 2);
}
