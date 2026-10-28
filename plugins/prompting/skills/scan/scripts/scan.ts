#!/usr/bin/env bun
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { cli } from "cleye";
import { table } from "table";
import { type Alert, lint } from "./vale";

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

export interface FileAlerts {
  path: string;
  alerts: Alert[];
}

export async function scanFiles(files: string[]): Promise<FileAlerts[]> {
  const alerts = await lint(files);
  return files.flatMap((path) => {
    const found = alerts.get(path);
    return found ? [{ path, alerts: found }] : [];
  });
}

function label(path: string): string {
  const rel = relative(".", path);
  return rel.startsWith("..") ? path : rel;
}

function printSummary(results: FileAlerts[]): void {
  const byCheck = new Map<string, number>();
  let total = 0;
  for (const { alerts } of results) {
    total += alerts.length;
    for (const alert of alerts) {
      byCheck.set(alert.Check, (byCheck.get(alert.Check) ?? 0) + 1);
    }
  }
  const rows = [...byCheck.entries()]
    .toSorted((a, b) => b[1] - a[1])
    .map(([check, count]) => [check, String(count)]);
  console.error(table([["Check", "Count"], ...rows]));
  console.error(`${total} alerts across ${results.length} files.`);
}

if (import.meta.main) {
  const argv = cli({
    name: "scan",
    parameters: ["[path]"],
    help: {
      description:
        "Report prompt defects in documents a model executes. Exits non-zero on any alert.",
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
        description: "Print alerts without the summary table",
      },
    },
  });

  const results = await scanFiles(await collectFiles(argv._.path ?? ".", argv.flags.all));
  for (const { path, alerts } of results) {
    const name = label(path);
    for (const alert of alerts) {
      console.log(`${name}:${alert.Line}:${alert.Span[0]}: ${alert.Check}: ${alert.Message}`);
    }
  }
  if (!argv.flags.quiet && results.length > 0) printSummary(results);
  process.exit(results.length > 0 ? 1 : 0);
}
