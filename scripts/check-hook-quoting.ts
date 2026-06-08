#!/usr/bin/env bun

import { hookCommands, loadPlugins } from "../packages/marketplace/index";

// Matches an unquoted ${CLAUDE_PLUGIN_ROOT}/... path segment in a command string.
// The path is unquoted if it is NOT preceded by a double quote.
const UNQUOTED_PATH = /(?<!")(\$\{CLAUDE_PLUGIN_ROOT\}\/\S+)/g;

const plugins = await loadPlugins();
const violations: string[] = [];

for (const plugin of plugins) {
  for (const { file, command: hook } of hookCommands(plugin)) {
    if (!hook.command?.includes("${CLAUDE_PLUGIN_ROOT}")) continue;

    for (const _match of hook.command.matchAll(UNQUOTED_PATH)) {
      violations.push(`${file}: ${hook.command}`);
      break;
    }
  }
}

if (violations.length > 0) {
  console.log("Hook commands with unquoted ${CLAUDE_PLUGIN_ROOT} paths:");
  for (const v of violations) {
    console.log(`  ${v}`);
  }
  process.exit(1);
}

console.log("All hook commands have properly quoted ${CLAUDE_PLUGIN_ROOT} paths");
