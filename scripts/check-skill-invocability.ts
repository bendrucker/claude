#!/usr/bin/env bun

import { join } from "node:path";
import matter from "gray-matter";
import { readAll, root, SKILL_GLOBS, skillName } from "./assets";
import { runCheck } from "./check";

// Bundled built-ins registered with `disableModelInvocation: true`, per section
// 8.3 of plugins/review/skills/code/references/upstream-2.1.215.md. Only
// `code-review` has a drift probe (scripts/check-review-drift.ts), so an entry
// upstream later makes model-invocable goes stale as a false positive here.
const USER_INVOCABLE_BUILTINS = new Set(["code-review", "verify", "batch"]);

export interface SkillFile {
  path: string;
  name: string;
  disabled: boolean;
  grants: string[];
}

/** Skill names an `allowed-tools` list grants, dropping any trailing arguments. */
export function skillGrants(allowedTools: string[]): string[] {
  return allowedTools.flatMap((entry) => {
    const match = /^Skill\(([^)]*)\)$/.exec(entry.trim());
    if (!match) return [];

    const [target] = (match[1] ?? "").trim().split(/\s+/);
    return target ? [target] : [];
  });
}

function unreachable(target: string, byName: Map<string, SkillFile>): string | undefined {
  if (USER_INVOCABLE_BUILTINS.has(target)) return "user-invocable-only built-in";

  const targeted = byName.get(target);
  if (targeted?.disabled) return `disable-model-invocation in ${targeted.path}`;

  // Unresolvable names are third-party plugin skills this repo cannot see.
  return undefined;
}

export function violations(files: SkillFile[]): string[] {
  const byName = new Map(files.map((file) => [file.name, file]));

  return files.flatMap((file) =>
    file.grants.flatMap((target) => {
      const reason = unreachable(target, byName);
      return reason ? [`${file.path}: Skill(${target}) (${reason})`] : [];
    }),
  );
}

async function read(path: string): Promise<SkillFile> {
  const { data } = matter(await Bun.file(join(root, path)).text());
  const allowedTools = data["allowed-tools"] as unknown;

  return {
    path,
    name: skillName(path, data.name as string | undefined),
    disabled: data["disable-model-invocation"] === true,
    grants: skillGrants(Array.isArray(allowedTools) ? allowedTools : []),
  };
}

export async function skillFiles(): Promise<SkillFile[]> {
  return readAll(SKILL_GLOBS, read);
}

if (import.meta.main) {
  await runCheck(
    async () => ({
      header: [
        "These skills grant Skill() on a target that cannot be reached through the Skill tool.",
        "The delegation fails at runtime:",
      ],
      violations: violations(await skillFiles()),
    }),
    { success: "All Skill() grants target model-invocable skills" },
  );
}
