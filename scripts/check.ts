import { join } from "node:path";
import { exit } from "node:process";
import { $ } from "bun";

/**
 * Repo-relative paths of git-tracked files matching a pathspec.
 *
 * The pathspec must stay interpolated: `Bun.$` glob-expands literal template
 * text, which would reduce `*.md` to root-level files before git sees it.
 */
export async function tracked(pattern: string, cwd: string): Promise<string[]> {
  const output = await $`git ls-files -z ${pattern}`.cwd(cwd).text();
  return output.split("\0").filter(Boolean);
}

/**
 * Contents of a tracked file, or null when it is absent from the working tree.
 *
 * `git ls-files` lists files deleted locally but not yet staged, so every
 * caller iterating a tracked list has to tolerate a missing file. Reading and
 * catching beats checking existence first, which doubles the syscalls and still
 * races: the file can vanish between the check and the read.
 */
export async function readTracked(file: string, cwd: string): Promise<string | null> {
  try {
    return await Bun.file(join(cwd, file)).text();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

export interface CheckResult {
  /** Lines printed before the violation list when violations exist. */
  header?: string | string[];
  /** Violation messages, one per line. */
  violations: string[];
}

export interface CheckOptions {
  /** Line printed when the check finds no violations. Omit to print nothing. */
  success?: string;
  /** Stream for violation output. Defaults to stdout. */
  stream?: "stdout" | "stderr";
  /** Indent each violation by two spaces under the header. Defaults to true. */
  indent?: boolean;
  /** Exit code when violations exist. Defaults to 1. */
  failureExit?: number;
}

type Check = () => CheckResult | Promise<CheckResult> | string[] | Promise<string[]>;

function normalize(result: CheckResult | string[]): CheckResult {
  return Array.isArray(result) ? { violations: result } : result;
}

/**
 * Runs a check, reports its violations, and exits non-zero when any exist.
 *
 * The check returns either a bare list of violation messages or a
 * {@link CheckResult} carrying a header to print above them. The runner owns
 * the load/report/exit shell shared by every `check-*.ts` script: print the
 * header and violations, exit on failure, and print the success line otherwise.
 */
export async function runCheck(check: Check, options: CheckOptions = {}): Promise<void> {
  const { success, stream = "stdout", indent = true, failureExit = 1 } = options;
  const { header, violations } = normalize(await check());
  const write = stream === "stderr" ? console.error : console.log;

  if (violations.length === 0) {
    if (success !== undefined) write(success);
    return;
  }

  for (const line of header === undefined ? [] : [header].flat()) {
    write(line);
  }
  for (const violation of violations) {
    write(indent ? `  ${violation}` : violation);
  }

  exit(failureExit);
}

function exportsFindViolations(
  module: unknown,
): module is { findViolations: () => Promise<unknown[]> } {
  return (
    typeof module === "object" &&
    module !== null &&
    "findViolations" in module &&
    typeof module.findViolations === "function"
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * Runs a check script's exported `findViolations` in this process.
 *
 * The import is dynamic so a script that cannot load (a missing module, a
 * syntax error) rejects here, where a hook can report it without blocking,
 * instead of failing the importer's own module graph.
 */
export async function importViolations(path: string): Promise<string[]> {
  const module: unknown = await import(path);
  if (!exportsFindViolations(module)) throw new Error(`${path} exports no findViolations`);
  const violations: unknown = await module.findViolations();
  if (!isStringArray(violations)) throw new Error(`${path} findViolations returned non-strings`);
  return violations;
}

/** The text {@link runCheck} writes for violations with no header and no indent. */
export function violationText(violations: string[]): string {
  return violations.map((line) => `${line}\n`).join("");
}
