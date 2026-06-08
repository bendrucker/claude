#!/usr/bin/env bun

import { globSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";

// The hooks engine substitutes only ${CLAUDE_PROJECT_DIR}, ${CLAUDE_PLUGIN_ROOT},
// and ${CLAUDE_PLUGIN_DATA} in hook command strings. ${CLAUDE_SKILL_DIR} is a
// skill-content substitution (body, ! injection, allowed-tools); inside a
// frontmatter hooks: command it resolves to an empty string, so the path
// collapses to /scripts/... and the hook fails with "Module not found".
// Reference bundled scripts by ${CLAUDE_PLUGIN_ROOT}/skills/<skill>/... instead.
const FORBIDDEN = /\$\{CLAUDE_SKILL_(?:DIR|ROOT)\}/;

const root = join(import.meta.dirname, "..");
const files = globSync("plugins/*/skills/*/SKILL.md", { cwd: root });

interface MatcherEntry {
  hooks?: Array<{ command?: string; args?: string[] }>;
}

const violations: string[] = [];

for (const file of files) {
  if (file.includes("/test/")) continue;

  const raw = await Bun.file(join(root, file)).text();
  const { data } = matter(raw);
  const hooks = data.hooks as Record<string, MatcherEntry[]> | undefined;
  if (!hooks) continue;

  for (const entries of Object.values(hooks)) {
    for (const entry of entries) {
      for (const hook of entry.hooks ?? []) {
        const command = hook.command ?? "";
        const args = (hook.args ?? []).join(" ");
        if (FORBIDDEN.test(command) || FORBIDDEN.test(args)) {
          violations.push(`${file}: ${command || args}`);
        }
      }
    }
  }
}

if (violations.length > 0) {
  console.log(
    "Hook commands must not use CLAUDE_SKILL_DIR/CLAUDE_SKILL_ROOT (the hooks engine leaves them empty).",
  );
  console.log("Use CLAUDE_PLUGIN_ROOT/skills/<skill>/... instead:");
  for (const v of violations) {
    console.log(`  ${v}`);
  }
  process.exit(1);
}

console.log("All skill hook commands use supported path placeholders");
