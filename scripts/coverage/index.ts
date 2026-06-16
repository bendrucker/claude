#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import { cli } from "cleye";
import { formatLcov } from "./lcov";
import { githubReport, terminalReport } from "./report";
import { repoRoot, runCoverage } from "./run";

function git(args: string[]): string {
  const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  return result.status === 0 ? result.stdout : "";
}

function isSourceFile(file: string): boolean {
  return file.endsWith(".ts") && !file.endsWith(".test.ts") && !file.endsWith(".integration.ts");
}

// Repo-relative .ts source files that changed against the base ref.
function changedFiles(base: string): string[] {
  return git(["diff", "--name-only", `${base}...HEAD`])
    .split("\n")
    .map((f) => f.trim())
    .filter((f) => f && isSourceFile(f));
}

// Map each changed file to the set of lines it added/modified, parsed from a
// zero-context diff. lcov keys files by their repo-relative path, and so does
// git diff, so the keys line up without rewriting.
function changedLines(base: string): Map<string, Set<number>> {
  const diff = git(["diff", "--unified=0", `${base}...HEAD`]);
  const byFile = new Map<string, Set<number>>();
  let current: Set<number> | null = null;

  for (const line of diff.split("\n")) {
    const fileMatch = line.match(/^\+\+\+ b\/(.+)$/);
    if (fileMatch?.[1]) {
      current = new Set();
      byFile.set(fileMatch[1], current);
      continue;
    }
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (hunk?.[1] && current) {
      const start = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      for (let n = start; n < start + count; n++) current.add(n);
    }
  }
  return byFile;
}

function persistLcov(reports: Parameters<typeof formatLcov>[0]): void {
  const dir = join(repoRoot, "coverage");
  mkdirSync(dir, { recursive: true });
  Bun.write(join(dir, "lcov.info"), formatLcov(reports));
}

const argv = cli({
  name: "coverage",
  parameters: ["[files...]"],
  help: {
    description: "Measure Bun test coverage and report uncovered lines.",
  },
  flags: {
    report: {
      type: String,
      default: "terminal",
      description: "Output format: terminal or github",
    },
    changed: {
      type: Boolean,
      description: "Restrict to files/lines changed against the base ref",
    },
    base: {
      type: String,
      default: "origin/main",
      description: "Base ref for --changed comparison",
    },
  },
});

let files = argv._.files;
if (files.length === 0 && argv.flags.changed) {
  files = changedFiles(argv.flags.base);
  if (files.length === 0) {
    console.log("No changed source files to measure.");
    process.exit(0);
  }
}

const reports = await runCoverage(files);

// Persist a merged report so the PostToolUse hook has fresh data to surface.
persistLcov(reports);

// When specific files were requested, focus the report on them.
const targets = files.length
  ? new Set(files.map((f) => relative(repoRoot, join(process.cwd(), f))))
  : null;
const scoped = targets ? reports.filter((fc) => targets.has(fc.file)) : reports;

if (argv.flags.report === "github") {
  const { summary, annotations } = githubReport(
    scoped,
    argv.flags.changed ? changedLines(argv.flags.base) : undefined,
  );
  for (const annotation of annotations) console.log(annotation);
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    await Bun.write(
      summaryPath,
      `${await Bun.file(summaryPath)
        .text()
        .catch(() => "")}${summary}\n`,
    );
  } else {
    console.log(summary);
  }
} else {
  console.log(terminalReport(scoped));
}
