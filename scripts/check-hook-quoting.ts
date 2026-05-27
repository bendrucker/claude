#!/usr/bin/env bun

import { globSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");

interface HookEntry {
  type: string;
  command: string;
}

interface MatcherEntry {
  matcher?: string;
  hooks: HookEntry[];
}

interface HooksFile {
  hooks: Record<string, MatcherEntry[]>;
}

// Matches an unquoted ${CLAUDE_PLUGIN_ROOT}/... path segment in a command string.
// The path is unquoted if it is NOT preceded by a double quote.
const UNQUOTED_PATH = /(?<!")(\$\{CLAUDE_PLUGIN_ROOT\}\/\S+)/g;

const files = globSync("plugins/*/hooks/hooks.json", { cwd: root });
const violations: string[] = [];

for (const file of files) {
  const content: HooksFile = await Bun.file(join(root, file)).json();

  for (const entries of Object.values(content.hooks)) {
    for (const entry of entries) {
      for (const hook of entry.hooks) {
        if (!hook.command?.includes("${CLAUDE_PLUGIN_ROOT}")) continue;

        for (const match of hook.command.matchAll(UNQUOTED_PATH)) {
          violations.push(`${file}: ${hook.command}`);
          break;
        }
      }
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
