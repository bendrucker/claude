#!/usr/bin/env osascript -l JavaScript
// @ts-check
/// <reference path="../src/jxa-globals.d.ts" />
/// <reference path="../src/url.d.ts" />

/**
 * Things URL scheme wrapper
 * Usage: osascript scripts/url.js <command> [key=value ...]
 * Examples:
 *   osascript scripts/url.js add title="Buy milk" when=today
 *   osascript scripts/url.js update id=ABC-123 append-notes="Done!"
 *   osascript scripts/url.js show id=today
 */

/** @type {import('../src/url').AuthRequiredCommand[]} */
const AUTH_REQUIRED_COMMANDS = ["update", "update-project", "json"];

/**
 * @param {string} command
 * @returns {command is import('../src/url').AuthRequiredCommand}
 */
function requiresAuth(command) {
  return AUTH_REQUIRED_COMMANDS.includes(/** @type {any} */ (command));
}

/**
 * @param {import('../src/url').JXAApplication} app
 * @returns {string}
 */
function getAuthToken(app) {
  try {
    return app.doShellScript('security find-generic-password -a "$USER" -s "things-auth-token" -w');
  } catch (_e) {
    throw new Error(
      "Things auth token not found in keychain. See 1password.md for setup instructions.",
    );
  }
}

/**
 * @param {string} command
 * @returns {command is import('../src/url').Command}
 */
function isValidCommand(command) {
  return [
    "add",
    "add-project",
    "update",
    "update-project",
    "show",
    "search",
    "json",
    "version",
  ].includes(command);
}

/**
 * @param {string[]} argv
 */
function _run(argv) {
  const command = argv[0];
  if (!command || !isValidCommand(command)) {
    console.log("Usage: osascript scripts/url.js <command> [key=value ...]");
    console.log("Commands: add, add-project, update, update-project, show, search, json");
    return;
  }

  /** @type {import('../src/url').JXAApplication} */
  const app = Application.currentApplication();
  app.includeStandardAdditions = true;

  /** @type {string[]} */
  const params = [];

  if (requiresAuth(command)) {
    const authToken = getAuthToken(app);
    params.push(`auth-token=${encodeURIComponent(authToken)}`);
  }

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    const eqIndex = arg.indexOf("=");
    if (eqIndex === -1) continue;

    const key = arg.substring(0, eqIndex);
    const value = arg.substring(eqIndex + 1);
    params.push(`${key}=${encodeURIComponent(value)}`);
  }

  let url = `things:///${command}`;
  if (params.length > 0) {
    url += `?${params.join("&")}`;
  }

  // show/search foreground Things; data commands run in background
  const background = command !== "show" && command !== "search";
  app.doShellScript(`open ${background ? "-g " : ""}"${url}"`);
}
