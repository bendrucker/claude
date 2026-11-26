#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import { Command } from "@commander-js/extra-typings";
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
    .filter((f) => f !== "" && isSourceFile(f));
}

async function persistLcov(reports: Parameters<typeof formatLcov>[0]): Promise<void> {
  const dir = join(repoRoot, "coverage");
  mkdirSync(dir, { recursive: true });
  await Bun.write(join(dir, "lcov.info"), formatLcov(reports));
}

export const program = new Command("coverage")
  .description("Measure Bun test coverage and report uncovered lines.")
  .argument("[files...]")
  .option("--report <format>", "Output format: terminal or github", "terminal")
  .option("--changed", "Restrict to files/lines changed against the base ref")
  .option("--base <ref>", "Base ref for --changed comparison", "origin/main")
  .action(async (requested, flags) => {
    let files = requested;
    if (files.length === 0 && flags.changed === true) {
      files = changedFiles(flags.base);
      if (files.length === 0) {
        console.log("No changed source files to measure.");
        process.exit(0);
      }
    }

    const reports = await runCoverage(files);

    // Persist a merged report so the PostToolUse hook has fresh data to surface.
    await persistLcov(reports);

    // When specific files were requested, focus the report on them.
    const targets =
      files.length > 0
        ? new Set(files.map((f) => relative(repoRoot, join(process.cwd(), f))))
        : null;
    const scoped = targets ? reports.filter((fc) => targets.has(fc.file)) : reports;

    if (flags.report === "github") {
      const summary = githubReport(scoped);
      const summaryPath = process.env.GITHUB_STEP_SUMMARY;
      if (summaryPath != null && summaryPath !== "") {
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
  });

if (import.meta.main) {
  await program.parseAsync();
}
