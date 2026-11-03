#!/usr/bin/env bun
import { relative, resolve } from "node:path";
import { cli } from "cleye";
import { table } from "table";
import { followImports, importers, scanRoots, type Unscanned } from "./imports";
import { type Alert, lint } from "./vale";

// Pass `--all` for a prompt that lives somewhere else, such as a string in a
// product repo extracted to a file.
export const AGENT_FACING =
  "{**/SKILL.md,**/CLAUDE.md,**/AGENTS.md,**/.claude/{agents,commands,rules}/**/*.md,**/skills/*/references/**/*.md,**/{prompt,prompts}/**/*.{md,txt}}";

// `--all` keeps to documents, which stops a walk from feeding source files to a
// prose check.
export const DOCUMENTS = "*.{md,txt}";

export interface ScanResult {
  alerts: Map<string, Alert[]>;
  unscanned: Unscanned[];
}

// A memory file loads its `@path` imports into context, so they are scanned
// too, through `DOCUMENTS` because they rarely match `AGENT_FACING`.
export async function scan(paths: readonly string[], all: boolean): Promise<ScanResult> {
  const sources = await importers(paths, (name) => all || name !== "CLAUDE.local.md");
  const [alerts, { targets, unscanned }] = await Promise.all([
    lint(paths, { glob: all ? DOCUMENTS : AGENT_FACING }),
    scanRoots(paths).then((roots) => followImports(sources, roots)),
  ]);
  const reported = new Set([...alerts.keys()].map((path) => resolve(path)));
  for (const [path, found] of await lint(targets, { glob: DOCUMENTS })) {
    if (!reported.has(resolve(path))) alerts.set(path, found);
  }
  return { alerts, unscanned };
}

export function fails(alerts: Map<string, Alert[]>): boolean {
  return [...alerts.values()].some((found) => found.length > 0);
}

function label(path: string): string {
  const rel = relative(".", path);
  return rel.startsWith("..") ? path : rel;
}

function printSummary(alerts: Map<string, Alert[]>): void {
  const byCheck = new Map<string, number>();
  let total = 0;
  for (const found of alerts.values()) {
    total += found.length;
    for (const alert of found) {
      byCheck.set(alert.Check, (byCheck.get(alert.Check) ?? 0) + 1);
    }
  }
  const rows = [...byCheck.entries()]
    .toSorted((a, b) => b[1] - a[1])
    .map(([check, count]) => [check, String(count)]);
  console.error(table([["Check", "Count"], ...rows]));
  console.error(`${total} alerts across ${alerts.size} files.`);
}

if (import.meta.main) {
  const argv = cli({
    name: "scan",
    parameters: ["[paths...]"],
    help: {
      description:
        "Report prompt defects in documents a model executes. Exits non-zero on an error-level alert.",
    },
    flags: {
      all: {
        type: Boolean,
        default: false,
        description: "Scan every document under the paths, skipping the agent-facing filter",
      },
      quiet: {
        type: Boolean,
        default: false,
        description: "Print alerts without the summary table",
      },
    },
  });

  const paths = argv._.paths.length > 0 ? argv._.paths : ["."];
  const { alerts, unscanned } = await scan(paths, argv.flags.all);
  for (const { from, path, reason } of unscanned) {
    console.error(`${label(from)}: unscanned import @${path} (${reason})`);
  }
  for (const [path, found] of alerts) {
    const name = label(path);
    for (const alert of found) {
      console.log(
        `${name}:${alert.Line}:${alert.Span[0]}: ${alert.Severity}: ${alert.Check}: ${alert.Message}`,
      );
    }
  }
  if (!argv.flags.quiet && alerts.size > 0) printSummary(alerts);
  process.exit(fails(alerts) ? 1 : 0);
}
