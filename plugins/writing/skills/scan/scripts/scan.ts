#!/usr/bin/env bun
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { cli } from "cleye";
import { table } from "table";
import { isMemoryPath, isPlanPath, isProseFile } from "../../../detection/paths";
import { type ScanResult, scanAll } from "../../../detection/scan";

const SKIP_SEGMENTS = ["node_modules", ".git"];
const WORDLIST_PATH = /(?:^|\/)wordlists\/[^/]+\.txt$/;

export function shouldSkip(path: string): boolean {
  if (SKIP_SEGMENTS.some((seg) => path.split("/").includes(seg))) return true;
  if (isMemoryPath(path) || isPlanPath(path)) return true;
  if (WORDLIST_PATH.test(path)) return true;
  return false;
}

export function toGlob(input: string): { cwd: string; pattern: string } {
  // readdirSync throws ENOTDIR on a file and ENOENT on a missing path, so a
  // successful call is the directory signal. (statSync is disallowed by biome.)
  try {
    readdirSync(input);
    return { cwd: input, pattern: "**/*" };
  } catch {
    return { cwd: ".", pattern: input };
  }
}

export async function collectFiles(input: string): Promise<string[]> {
  const { cwd, pattern } = toGlob(input);
  const glob = new Bun.Glob(pattern);
  const files: string[] = [];
  for await (const entry of glob.scan({ cwd, onlyFiles: true })) {
    const path = cwd === "." ? entry : join(cwd, entry);
    if (shouldSkip(path)) continue;
    if (!isProseFile(path)) continue;
    files.push(path);
  }
  return files.sort();
}

export async function readInput(
  arg: string | undefined,
): Promise<{ text: string; filePath?: string }> {
  if (arg && (await Bun.file(arg).exists())) {
    return { text: await Bun.file(arg).text(), filePath: arg };
  }
  if (arg) {
    return { text: arg };
  }
  return { text: await new Response(Bun.stdin.stream()).text() };
}

function scanInput(text: string, filePath: string | undefined): number {
  const violations = scanAll(text, filePath);

  if (violations.length === 0) {
    console.log("No violations found.");
    return 0;
  }

  for (const v of violations) {
    console.log(`${v.line}:${v.col}: ${v.category}: ${v.message}`);
  }
  return 1;
}

export type FileViolations = { path: string; violations: ScanResult[] };

export async function scanFiles(files: string[]): Promise<FileViolations[]> {
  const results: FileViolations[] = [];
  for (const path of files) {
    const text = await Bun.file(path).text();
    const violations = scanAll(text, path);
    if (violations.length > 0) results.push({ path, violations });
  }
  return results;
}

function relativeLabel(path: string): string {
  const rel = relative(".", path);
  return rel.startsWith("..") ? path : rel;
}

function printViolations(results: FileViolations[]): void {
  for (const { path, violations } of results) {
    for (const v of violations) {
      console.log(`${relativeLabel(path)}:${v.line}:${v.col}: ${v.category}: ${v.message}`);
    }
  }
}

function printSummary(results: FileViolations[]): void {
  const byCategory = new Map<string, number>();
  const byFile = new Map<string, number>();
  let total = 0;
  for (const { path, violations } of results) {
    byFile.set(path, violations.length);
    total += violations.length;
    for (const v of violations) {
      byCategory.set(v.category, (byCategory.get(v.category) ?? 0) + 1);
    }
  }

  const categoryRows = [...byCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => [category, String(count)]);
  console.error(table([["Category", "Count"], ...categoryRows]));

  const noisiest = [...byFile.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([path, count]) => [relativeLabel(path), String(count)]);
  console.error(table([["File", "Violations"], ...noisiest]));

  console.error(`${total} violations across ${results.length} files.`);
}

async function main(): Promise<void> {
  const argv = cli({
    name: "scan",
    parameters: ["[path]"],
    help: {
      description:
        "Scan existing repository prose for AI writing tropes. Pass a directory or a glob; reports every match per file with a summary. With --input, scan a single file, inline text, or stdin and report matches as line:col without a path prefix.",
    },
    flags: {
      input: {
        type: Boolean,
        description:
          "Scan a single input (file path, inline text, or stdin) instead of walking a directory",
        default: false,
      },
      noSummary: {
        type: Boolean,
        description: "Suppress the trailing summary table",
        default: false,
      },
    },
  });

  if (argv.flags.input) {
    const { text, filePath } = await readInput(argv._.path);
    process.exit(scanInput(text, filePath));
  }

  if (!argv._.path) {
    argv.showHelp();
    process.exit(1);
  }

  const results = await scanFiles(await collectFiles(argv._.path));
  printViolations(results);

  if (results.length > 0 && !argv.flags.noSummary) {
    printSummary(results);
  }

  process.exit(results.length > 0 ? 1 : 0);
}

if (import.meta.main) {
  await main();
}
