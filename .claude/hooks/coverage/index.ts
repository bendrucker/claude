#!/usr/bin/env bun

import { join, relative } from "node:path";
import type { PostToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { parseLcov, uncoveredLines } from "../../../scripts/coverage/lcov";

const repoRoot = join(import.meta.dirname, "..", "..", "..");

function isSourceFile(file: string): boolean {
  return file.endsWith(".ts") && !file.endsWith(".test.ts") && !file.endsWith(".integration.ts");
}

export interface CoverageHint {
  /** Repo-relative path, matching the lcov `SF:` key. */
  file: string;
  uncovered: number[];
  /** The file was edited after the coverage data was produced. */
  stale: boolean;
}

export function isStale(fileMtimeMs: number, lcovMtimeMs: number): boolean {
  return fileMtimeMs > lcovMtimeMs;
}

// Look up the edited file in the latest coverage report. Returns null (stay
// silent) when there is no coverage data, the file was never measured, or it is
// already fully covered.
export async function computeHint(
  filePath: string,
  lcovPath = join(repoRoot, "coverage", "lcov.info"),
): Promise<CoverageHint | null> {
  const lcovFile = Bun.file(lcovPath);
  const sourceFile = Bun.file(filePath);
  if (!(await lcovFile.exists()) || !(await sourceFile.exists())) return null;

  const rel = relative(repoRoot, filePath);
  const report = parseLcov(await lcovFile.text());
  const fc = report.find((r) => r.file === rel);
  if (!fc) return null;

  const uncovered = uncoveredLines(fc);
  if (uncovered.length === 0) return null;

  return { file: rel, uncovered, stale: isStale(sourceFile.lastModified, lcovFile.lastModified) };
}

export function formatHint(hint: CoverageHint): string {
  const lines = hint.uncovered.join(", ");
  const staleNote = hint.stale
    ? "\n\nThis coverage data predates your edit. Re-run `bun scripts/coverage/index.ts " +
      `${hint.file}\` to refresh it.`
    : "";
  return (
    `${hint.file} has uncovered lines: ${lines}.\n\n` +
    "Add tests targeting these lines, then re-run coverage to confirm. " +
    "The `coverage` skill documents the loop." +
    staleNote
  );
}

export async function processPostToolUse(
  input: PostToolUseHookInput,
): Promise<SyncHookJSONOutput | null> {
  if (input.tool_name !== "Edit" && input.tool_name !== "Write") return null;

  const filePath = (input.tool_input as { file_path?: string }).file_path;
  if (!filePath || !isSourceFile(filePath)) return null;

  const hint = await computeHint(filePath);
  if (!hint) return null;

  return {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: formatHint(hint),
    },
  };
}

async function main(): Promise<void> {
  let input: PostToolUseHookInput;
  try {
    input = JSON.parse(await Bun.stdin.text()) as PostToolUseHookInput;
  } catch (error) {
    console.error(
      `[coverage] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const output = await processPostToolUse(input);
  if (output) {
    process.stdout.write(`${JSON.stringify(output)}\n`);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
