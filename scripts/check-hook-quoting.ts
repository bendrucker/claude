#!/usr/bin/env bun

import { hookCommands, loadPlugins } from "../packages/marketplace/index";
import { runCheck } from "./check";

// Matches an unquoted ${CLAUDE_PLUGIN_ROOT}/... path segment in a command string.
// The path is unquoted if it is NOT preceded by a double quote.
const UNQUOTED_PATH = /(?<!")(\$\{CLAUDE_PLUGIN_ROOT\}\/\S+)/g;

async function checkQuoting(): Promise<string[]> {
  const plugins = await loadPlugins();
  const violations: string[] = [];

  for (const plugin of plugins) {
    for (const { file, command: hook } of hookCommands(plugin)) {
      if (!hook.command?.includes("${CLAUDE_PLUGIN_ROOT}")) continue;

      if (hook.command.search(UNQUOTED_PATH) !== -1) {
        violations.push(`${file}: ${hook.command}`);
      }
    }
  }

  return violations;
}

await runCheck(
  async () => ({
    header: "Hook commands with unquoted ${CLAUDE_PLUGIN_ROOT} paths:",
    violations: await checkQuoting(),
  }),
  { success: "All hook commands have properly quoted ${CLAUDE_PLUGIN_ROOT} paths" },
);
