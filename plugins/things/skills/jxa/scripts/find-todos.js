#!/usr/bin/env osascript -l JavaScript
// @ts-check
/// <reference path="../../../src/jxa-globals.d.ts" />

/**
 * Find todos by tag or project
 * Usage: osascript scripts/find-todos.js --tag "Work"
 *        osascript scripts/find-todos.js --project "Website Redesign"
 */

/**
 * @param {string[]} argv
 */
function run(argv) {
  let mode = null;
  let value = null;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--tag" && i + 1 < argv.length) {
      mode = "tag";
      value = argv[i + 1];
      i++;
    } else if (argv[i] === "--project" && i + 1 < argv.length) {
      mode = "project";
      value = argv[i + 1];
      i++;
    }
  }

  if (!mode || !value) {
    console.log('Usage: osascript scripts/find-todos.js --tag "Name"');
    console.log('       osascript scripts/find-todos.js --project "Name"');
    return JSON.stringify({ error: "Provide --tag or --project with a name" });
  }

  const app = Application("Things3");

  if (mode === "tag") {
    const tag = app.tags.whose({ name: value })[0];
    if (!tag) {
      return JSON.stringify({ error: "Tag not found: " + value });
    }
    const items = tag.toDos();
    const result = [];
    for (let i = 0; i < items.length; i++) {
      const t = items[i];
      const project = t.project();
      result.push({
        id: t.id(),
        name: t.name(),
        status: t.status().toString(),
        project: project ? project.name() : null,
      });
    }
    return JSON.stringify(result, null, 2);
  }

  if (mode === "project") {
    const project = app.projects.whose({ name: value })[0];
    if (!project) {
      return JSON.stringify({ error: "Project not found: " + value });
    }
    const items = project.toDos();
    const result = [];
    for (let i = 0; i < items.length; i++) {
      const t = items[i];
      result.push({
        id: t.id(),
        name: t.name(),
        status: t.status().toString(),
        notes: t.notes() || "",
      });
    }
    return JSON.stringify(result, null, 2);
  }
}
