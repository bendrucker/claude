#!/usr/bin/env bun

import { join } from "node:path";
import { z } from "zod";
import { decode } from "../packages/decode/index";
import { assetPaths, frontmatter, root, SKILL_GLOBS } from "./assets";
import { runCheck } from "./check";

// The hooks engine substitutes only ${CLAUDE_PROJECT_DIR}, ${CLAUDE_PLUGIN_ROOT},
// and ${CLAUDE_PLUGIN_DATA} in hook command strings. ${CLAUDE_SKILL_DIR} is a
// skill-content substitution (body, ! injection, allowed-tools); inside a
// frontmatter hooks: command it resolves to an empty string, so the path
// collapses to /scripts/... and the hook fails with "Module not found".
// Reference bundled scripts by ${CLAUDE_PLUGIN_ROOT}/skills/<skill>/... instead.
const FORBIDDEN = /\$\{CLAUDE_SKILL_(?:DIR|ROOT)\}/;

const MatcherEntry = z.looseObject({
  hooks: z
    .array(z.looseObject({ command: z.string().optional(), args: z.array(z.string()).optional() }))
    .optional(),
});

const SkillHooks = z.record(z.string(), z.array(MatcherEntry)).optional();

async function checkSkillHookVars(): Promise<string[]> {
  const violations: string[] = [];

  for await (const file of assetPaths(SKILL_GLOBS)) {
    const data = frontmatter(await Bun.file(join(root, file)).text(), file);
    const hooks = decode(SkillHooks, data.hooks, `${file} hooks`);
    if (!hooks) continue;

    for (const entry of Object.values(hooks).flat()) {
      for (const hook of entry.hooks ?? []) {
        const command = hook.command ?? "";
        const args = (hook.args ?? []).join(" ");
        if (FORBIDDEN.test(command) || FORBIDDEN.test(args)) {
          violations.push(`${file}: ${command !== "" ? command : args}`);
        }
      }
    }
  }

  return violations;
}

await runCheck(
  async () => ({
    header: [
      "Hook commands must not use CLAUDE_SKILL_DIR/CLAUDE_SKILL_ROOT (the hooks engine leaves them empty).",
      "Use CLAUDE_PLUGIN_ROOT/skills/<skill>/... instead:",
    ],
    violations: await checkSkillHookVars(),
  }),
  { success: "All skill hook commands use supported path placeholders" },
);
