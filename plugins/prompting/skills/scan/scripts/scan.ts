#!/usr/bin/env bun
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { cli } from "cleye";
import { table } from "table";
import { type Finding, scanPrompt } from "./rules";

const SKIP_SEGMENTS = ["node_modules", ".git", "fixtures", "__snapshots__"];

// Pass an explicit file or glob for a prompt that lives somewhere else, such
// as a string in a product repo extracted to a file.
const AGENT_FACING = [
  /(?:^|\/)SKILL\.md$/,
  /(?:^|\/)(?:CLAUDE|AGENTS)\.md$/,
  /(?:^|\/)\.claude\/(?:agents|commands|rules)\/.+\.md$/,
  /(?:^|\/)skills\/[^/]+\/references\/.+\.md$/,
  /(?:^|\/)prompts?\/.+\.(?:md|txt)$/,
];

export function isAgentFacing(path: string): boolean {
  return AGENT_FACING.some((pattern) => pattern.test(path));
}

export function shouldSkip(path: string): boolean {
  return SKIP_SEGMENTS.some((segment) => path.split("/").includes(segment));
}

// A directory walk reads whatever it finds, so it looks at documents alone.
// `--all` drops the agent-facing filter and keeps this one, which is what stops
// it from feeding source files and binaries to a prose scanner.
const DOCUMENTS = "**/*.{md,txt}";

export function toGlob(input: string): { cwd: string; pattern: string } {
  // readdirSync throws ENOTDIR on a file and ENOENT on a missing path, so a
  // successful call is the directory signal. (statSync is disallowed by oxlint.)
  try {
    readdirSync(input);
    return { cwd: input, pattern: DOCUMENTS };
  } catch {
    return { cwd: ".", pattern: input };
  }
}

export async function collectFiles(input: string, all: boolean): Promise<string[]> {
  const { cwd, pattern } = toGlob(input);
  const glob = new Bun.Glob(pattern);
  const files: string[] = [];
  // `.claude/agents`, `.claude/commands`, and `.claude/rules` all sit under a
  // dot directory, which Bun.Glob skips unless asked for it.
  for await (const entry of glob.scan({ cwd, onlyFiles: true, dot: true })) {
    const path = cwd === "." ? entry : join(cwd, entry);
    if (shouldSkip(path)) continue;
    if (!all && !isAgentFacing(path)) continue;
    files.push(path);
  }
  return files.toSorted();
}

export interface FileFindings {
  path: string;
  findings: Finding[];
}

export async function scanFiles(files: string[]): Promise<FileFindings[]> {
  const results: FileFindings[] = [];
  for (const path of files) {
    // oxlint-disable-next-line no-await-in-loop -- an audit walks an arbitrary tree. Reading every file at once would hold the whole corpus in memory.
    const findings = scanPrompt(await Bun.file(path).text());
    if (findings.length > 0) results.push({ path, findings });
  }
  return results;
}

function label(path: string): string {
  const rel = relative(".", path);
  return rel.startsWith("..") ? path : rel;
}

function printSummary(results: FileFindings[]): void {
  const byRule = new Map<string, number>();
  let total = 0;
  for (const { findings } of results) {
    total += findings.length;
    for (const finding of findings) {
      byRule.set(finding.rule, (byRule.get(finding.rule) ?? 0) + 1);
    }
  }
  const rows = [...byRule.entries()]
    .toSorted((a, b) => b[1] - a[1])
    .map(([rule, count]) => [rule, String(count)]);
  console.error(table([["Rule", "Count"], ...rows]));
  console.error(`${total} findings across ${results.length} files.`);
}

if (import.meta.main) {
  const argv = cli({
    name: "scan",
    parameters: ["[path]"],
    help: {
      description:
        "Report prompt defects in documents a model executes. Exits non-zero on any finding.",
    },
    flags: {
      all: {
        type: Boolean,
        default: false,
        description: "Scan every document under the path, skipping the agent-facing filter",
      },
      quiet: {
        type: Boolean,
        default: false,
        description: "Print findings without the summary table",
      },
    },
  });

  const results = await scanFiles(await collectFiles(argv._.path ?? ".", argv.flags.all));
  for (const { path, findings } of results) {
    const name = label(path);
    for (const finding of findings) {
      console.log(`${name}:${finding.line}:${finding.col}: ${finding.rule}: ${finding.message}`);
    }
  }
  if (!argv.flags.quiet && results.length > 0) printSummary(results);
  process.exit(results.length > 0 ? 1 : 0);
}
