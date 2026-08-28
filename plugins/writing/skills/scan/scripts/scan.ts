#!/usr/bin/env bun
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { cli, command } from "cleye";
import { table } from "table";
import { isMemoryPath, isPlanPath, isProseFile } from "../../../detection/paths";
import { type ScanResult, scanAll } from "../../../detection/scan";
import { readInput } from "../../../scripts/io";
import { profilePath, resolveDataDir } from "../../analyze/scripts/data-dir";
import { loadProfile } from "../../analyze/scripts/voice-profile";
import {
  buildReport,
  loadCustomMatch,
  type ReportOptions,
  renderTable,
  renderVoiceDeltaTable,
  shouldScoreComments,
} from "./score";

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
  // successful call is the directory signal. (statSync is disallowed by oxlint.)
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
  return files.toSorted();
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
    // oxlint-disable-next-line no-await-in-loop -- audit runs over an arbitrary tree; reading every file at once would hold the whole corpus in memory.
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
    .toSorted((a, b) => b[1] - a[1])
    .map(([category, count]) => [category, String(count)]);
  console.error(table([["Category", "Count"], ...categoryRows]));

  const noisiest = [...byFile.entries()]
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([path, count]) => [relativeLabel(path), String(count)]);
  console.error(table([["File", "Violations"], ...noisiest]));

  console.error(`${total} violations across ${results.length} files.`);
}

async function collectAcross(paths: string[]): Promise<string[]> {
  const files = new Set<string>();
  for (const collected of await Promise.all(paths.map(collectFiles))) {
    for (const file of collected) files.add(file);
  }
  return [...files].toSorted();
}

const auditCmd = command(
  {
    name: "audit",
    parameters: ["[path...]"],
    help: {
      description:
        "Walk a directory or glob and report every trope with its file, line, and column. Exits non-zero on any finding, so it gates in CI or pre-commit checks.",
    },
    flags: {
      noSummary: {
        type: Boolean,
        description: "Suppress the trailing summary table",
        default: false,
      },
    },
  },
  async (argv) => {
    const paths = argv._.path;
    if (paths.length === 0) {
      argv.showHelp();
      process.exit(1);
    }

    const results = await scanFiles(await collectAcross(paths));
    printViolations(results);

    if (results.length > 0 && !argv.flags.noSummary) {
      printSummary(results);
    }

    process.exit(results.length > 0 ? 1 : 0);
  },
);

const scoreCmd = command(
  {
    name: "score",
    parameters: ["[input]"],
    help: {
      description:
        "Score one input (file path, inline text, or stdin) for trope density per 1000 words. Informational: always exits 0.",
    },
    flags: {
      json: {
        type: Boolean,
        description: "Emit the report as JSON for comparing two runs",
        default: false,
      },
      comments: {
        type: Boolean,
        description:
          "Force comment extraction on (defaults on for non-prose source files, off for prose)",
      },
      noComments: {
        type: Boolean,
        description: "Force comment extraction off",
        default: false,
      },
      wordlist: {
        type: String,
        description: "Score an extra stemmed vocabulary file as a 'custom vocabulary' category",
      },
      voiceDelta: {
        type: Boolean,
        description:
          "Report voice-delta rate features alongside the baseline from the local voice profile. Skips baseline comparison when the input is out-of-register.",
        default: false,
      },
      dataDir: {
        type: String,
        description:
          "Local data dir for the voice baseline (default: CLAUDE_PLUGIN_DATA or ~/.claude/plugins/data/writing-bendrucker). Only used with --voice-delta.",
      },
    },
  },
  async (argv) => {
    const { text, filePath } = await readInput(argv._.input);
    const customMatch = await loadCustomMatch(argv.flags.wordlist);
    const options: ReportOptions = {
      comments: shouldScoreComments(filePath, argv.flags.comments, argv.flags.noComments),
    };
    if (customMatch) options.customMatch = customMatch;
    const report = buildReport(text, filePath, options);

    if (argv.flags.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(renderTable(report));
    }

    if (argv.flags.voiceDelta) {
      const dataDir = resolveDataDir(argv.flags.dataDir);
      const profileData = await loadProfile(profilePath(dataDir));
      console.log(`\n${renderVoiceDeltaTable(text, profileData)}`);
    }

    process.exit(0);
  },
);

if (import.meta.main) {
  await cli(
    {
      name: "scan",
      commands: [auditCmd, scoreCmd],
      parameters: ["[path]"],
      help: {
        description:
          "Detect AI writing tropes in repository prose. `audit` walks a path and gates non-zero on findings; `score` measures trope density of one input and always exits 0.",
      },
      flags: {
        input: {
          type: Boolean,
          description:
            "Scan a single input (file path, inline text, or stdin) and report matches as line:col without a path prefix. Exits non-zero on any finding.",
          default: false,
        },
      },
    },
    async (argv) => {
      if (argv.flags.input) {
        const { text, filePath } = await readInput(argv._.path);
        process.exit(scanInput(text, filePath));
      }
      argv.showHelp();
      process.exit(1);
    },
  );
}
