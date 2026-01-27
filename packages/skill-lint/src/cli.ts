#!/usr/bin/env bun
import * as fs from "node:fs";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { formatJson, formatText } from "./format";
import { lintSkill } from "./index";

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

const skillDirs = positionals.flatMap((pattern) => {
  if (pattern.includes("*")) {
    const base = pattern.split("*")[0] ?? "";
    const suffix = pattern.split("*").slice(1).join("*");

    if (!fs.existsSync(base)) return [];

    return fs
      .readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(base, d.name, suffix.replace(/^\*?\/?/, "")))
      .filter((p) => fs.existsSync(path.join(p, "SKILL.md")));
  }

  if (fs.existsSync(path.join(pattern, "SKILL.md"))) {
    return [pattern];
  }

  return [];
});

if (skillDirs.length === 0) {
  console.error("No skill directories found");
  process.exit(1);
}

const results = skillDirs.map((dir) => lintSkill(dir));

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
