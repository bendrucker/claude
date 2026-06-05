#!/usr/bin/env bun

import { join } from "node:path";
import { loadPlugins } from "@bendrucker/claude-marketplace";

// A hook's stdout is injected into the model as context, so it must carry only
// the decision payload. bun's install/lockfile banner prints to stdout and
// leaks in when node_modules is stale. Every bun hook must run through
// hooks/run.sh, which installs deps silently off stdout and runs the script
// with --no-install. Flag any hook command that still invokes bun directly.

const BARE_BUN = /(^|\s|=)bun\s/;

/** True when a hook command invokes bun directly instead of through run.sh. */
export function invokesBunDirectly(command: string | undefined): boolean {
  if (!command) return false;
  return BARE_BUN.test(command);
}

interface SettingsHooks {
  hooks?: Record<string, Array<{ hooks?: Array<{ command?: string }> }>>;
}

if (import.meta.main) {
  const root = join(import.meta.dirname, "..");
  const violations: string[] = [];

  const plugins = await loadPlugins();
  for (const plugin of plugins) {
    if (!plugin.hooks) continue;
    const file = `plugins/${plugin.name}/hooks/hooks.json`;
    for (const entries of Object.values(plugin.hooks.hooks)) {
      for (const entry of entries) {
        for (const hook of entry.hooks) {
          if (invokesBunDirectly(hook.command)) {
            violations.push(`${file}: ${hook.command}`);
          }
        }
      }
    }
  }

  for (const relative of ["user/settings.json", ".claude/settings.json"]) {
    const file = Bun.file(join(root, relative));
    if (!(await file.exists())) continue;
    const settings = (await file.json()) as SettingsHooks;
    for (const entries of Object.values(settings.hooks ?? {})) {
      for (const entry of entries) {
        for (const hook of entry.hooks ?? []) {
          if (invokesBunDirectly(hook.command)) {
            violations.push(`${relative}: ${hook.command}`);
          }
        }
      }
    }
  }

  if (violations.length > 0) {
    console.log("Hook commands that invoke bun directly instead of hooks/run.sh:");
    for (const v of violations) console.log(`  ${v}`);
    console.log("\nbun's install banner prints to stdout and leaks into hook context.");
    console.log('Wrap each command as: sh "<base>/hooks/run.sh" "<script>" <args>');
    process.exit(1);
  }

  console.log("All bun hook commands run through hooks/run.sh");
}
