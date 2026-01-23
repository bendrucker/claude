#!/usr/bin/env osascript -l JavaScript
// @ts-check
/// <reference path="../src/jxa-globals.d.ts" />
/// <reference path="../src/url.d.ts" />

/**
 * Reorder items in a Things list
 * Usage: osascript scripts/reorder.js [--list <list>] <id1> <id2> <id3> ...
 *
 * Options:
 *   --list <list>  Target list: today (default), anytime, someday
 *
 * Items are placed in the list in the order specified.
 * Items not in the arguments retain their relative position after the specified items.
 */

const INTERMEDIATE_LIST = {
  today: "anytime",
  anytime: "someday",
  someday: "anytime",
};

/**
 * @param {import('../src/url').JXAApplication} app
 * @returns {string}
 */
function getAuthToken(app) {
  return app.doShellScript('security find-generic-password -a "$USER" -s "things-auth-token" -w');
}

/**
 * @param {import('../src/url').JXAApplication} app
 * @param {string} token
 * @param {Array<{type: string, operation: string, id: string, attributes: object}>} data
 */
function executeJsonUpdate(app, token, data) {
  const url =
    "things:///json?auth-token=" +
    encodeURIComponent(token) +
    "&data=" +
    encodeURIComponent(JSON.stringify(data));
  app.doShellScript(`open -g "${url}"`);
}

/**
 * @param {string[]} argv
 */
function _run(argv) {
  let targetList = "today";
  const ids = [];

  // Parse arguments
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--list" && i + 1 < argv.length) {
      targetList = argv[i + 1];
      i++;
    } else {
      ids.push(argv[i]);
    }
  }

  if (ids.length === 0) {
    console.log("Usage: osascript scripts/reorder.js [--list <list>] <id1> <id2> ...");
    console.log("Lists: today (default), anytime, someday");
    return JSON.stringify({ error: "No IDs provided" });
  }

  const intermediate = INTERMEDIATE_LIST[targetList];
  if (!intermediate) {
    return JSON.stringify({ error: `Invalid list: ${targetList}` });
  }

  /** @type {import('../src/url').JXAApplication} */
  const app = Application.currentApplication();
  app.includeStandardAdditions = true;

  const token = getAuthToken(app);

  // Move all items to intermediate list (clears their position)
  const intermediateData = ids.map((id) => ({
    type: "to-do",
    operation: "update",
    id: id,
    attributes: { when: intermediate },
  }));
  executeJsonUpdate(app, token, intermediateData);

  // Move items to target list in desired order (assigns sequential indices)
  const targetData = ids.map((id) => ({
    type: "to-do",
    operation: "update",
    id: id,
    attributes: { when: targetList },
  }));
  executeJsonUpdate(app, token, targetData);

  return JSON.stringify({ success: true, list: targetList, reordered: ids.length });
}
