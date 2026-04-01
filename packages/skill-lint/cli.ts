#!/usr/bin/env bun
import { readdirSync } from "node:fs";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { lintSkill } from "../../plugins/claude-code/skills/skill/scripts/skill-lint/index";
import { formatJson, formatText } from "./format";

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    json: { type: "boolean", default: false },
    strict: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  allowPositionals: true,
});

if (values.help || positionals.length === 0) {
  console.log(`skill-lint - Lint Claude Code skills

Usage:
  skill-lint [options] <skill-dir>...

Options:
  --json     Output JSON instead of text
  --strict   Fail on warnings (exit code 2)
  -h, --help Show this help

Examples:
  skill-lint plugins/linear/skills/linear/
  skill-lint plugins/terraform/skills/*/
  skill-lint --json plugins/*/skills/*

Exit codes:
  0  All rules pass
  1  Errors found
  2  Warnings only (with --strict)`);
  process.exit(0);
}

function tryReaddir(dir: string) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
}

async function resolveSkillDirs(patterns: string[]): Promise<string[]> {
  const dirs: string[] = [];
  for (const pattern of patterns) {
    if (pattern.includes("*")) {
      const base = pattern.split("*")[0] ?? "";
      const suffix = pattern.split("*").slice(1).join("*");

      const entries = tryReaddir(base);
      if (!entries) continue;
      for (const d of entries) {
        if (!d.isDirectory()) continue;
        const p = path.join(base, d.name, suffix.replace(/^\*?\/?/, ""));
        if (await Bun.file(path.join(p, "SKILL.md")).exists()) {
          dirs.push(p);
        }
      }
    } else if (await Bun.file(path.join(pattern, "SKILL.md")).exists()) {
      dirs.push(pattern);
    }
  }
  return dirs;
}

const skillDirs = await resolveSkillDirs(positionals);

if (skillDirs.length === 0) {
  console.error("No skill directories found");
  process.exit(1);
}

const results = await Promise.all(skillDirs.map((dir) => lintSkill(dir)));

if (values.json) {
  console.log(formatJson(results));
} else {
  console.log(formatText(results));
}

const hasErrors = results.some((r) => r.errors > 0);
const hasWarnings = results.some((r) => r.warnings > 0);

if (hasErrors) {
  process.exit(1);
} else if (hasWarnings && values.strict) {
  process.exit(2);
} else {
  process.exit(0);
}
