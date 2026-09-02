#!/usr/bin/env bun

import { readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { cli } from "cleye";
import { z } from "zod";
import { decodeJson } from "../../packages/decode/index";
import { expectSuccess, type RunCommand, runCommand } from "./command";
import { importEval } from "./promptfoo";
import { destination, ExportPayload, resultsDir } from "./results";

export const DEFAULT_WORKFLOW = "eval.yml";
export const RUN_FIELDS = "databaseId,conclusion,createdAt,displayTitle,headBranch";

export const WorkflowRun = z.looseObject({
  databaseId: z.number(),
  conclusion: z.string(),
  createdAt: z.string(),
  displayTitle: z.string().optional(),
  headBranch: z.string().optional(),
});
export type WorkflowRun = z.infer<typeof WorkflowRun>;

export interface SelectOptions {
  limit: number;
  conclusion?: string | undefined;
}

export function selectRuns(runs: readonly WorkflowRun[], options: SelectOptions): WorkflowRun[] {
  const wanted = options.conclusion ?? "success";
  return runs
    .filter((run) => wanted === "any" || run.conclusion === wanted)
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, options.limit);
}

export interface GhOptions {
  repo?: string | undefined;
  run?: RunCommand | undefined;
}

function withRepo(command: string[], repo: string | undefined): string[] {
  return repo === undefined ? command : [...command, "--repo", repo];
}

export function listCommand(workflow: string, limit: number, repo?: string): string[] {
  return withRepo(
    ["gh", "run", "list", "--workflow", workflow, "--json", RUN_FIELDS, "--limit", String(limit)],
    repo,
  );
}

export function downloadCommand(runId: number, dir: string, repo?: string): string[] {
  return withRepo(["gh", "run", "download", String(runId), "--dir", dir], repo);
}

export async function listRuns(
  workflow: string,
  limit: number,
  options: GhOptions = {},
): Promise<WorkflowRun[]> {
  const run = options.run ?? runCommand;
  // Conclusions other than success are filtered out afterwards, so ask for a
  // wider window than the caller's limit.
  const command = listCommand(workflow, limit * 4, options.repo);
  const result = expectSuccess(command, await run(command));
  return decodeJson(z.array(WorkflowRun), result.stdout, "gh run list output");
}

export interface DiscoveredExport {
  path: string;
  payload: ExportPayload;
}

/** Every JSON file under `dir` that parses as a promptfoo export, in path order. */
export async function discoverExports(dir: string): Promise<DiscoveredExport[]> {
  let entries: string[];
  try {
    entries = readdirSync(dir, { recursive: true }).map(String);
  } catch {
    return [];
  }

  const found: DiscoveredExport[] = [];
  for (const entry of entries.toSorted()) {
    if (!entry.endsWith(".json")) continue;
    const full = path.join(dir, entry);
    // oxlint-disable-next-line no-await-in-loop -- artifact trees are small; sequential reads keep the order deterministic.
    const text = await Bun.file(full).text();
    const discovered = readExport(full, text);
    if (discovered !== null) found.push(discovered);
  }
  return found;
}

// An artifact tree carries whatever the workflow uploaded, so a file that is not a
// promptfoo export is skipped rather than failing the collection.
function readExport(file: string, text: string): DiscoveredExport | null {
  try {
    const parsed = ExportPayload.safeParse(JSON.parse(text));
    return parsed.success ? { path: file, payload: parsed.data } : null;
  } catch {
    return null;
  }
}

export interface CollectOptions extends GhOptions {
  dir: string;
  suite?: string | undefined;
  bin?: string | undefined;
}

export async function collectRun(runId: number, options: CollectOptions): Promise<string[]> {
  const run = options.run ?? runCommand;
  const staging = await mkdtemp(path.join(tmpdir(), `eval-ci-${runId}-`));
  try {
    const command = downloadCommand(runId, staging, options.repo);
    expectSuccess(command, await run(command));

    const collected: string[] = [];
    for (const found of await discoverExports(staging)) {
      // oxlint-disable-next-line no-await-in-loop -- promptfoo import writes one SQLite database; concurrent imports contend on it.
      await importEval(found.path, { run: options.run, bin: options.bin });
      const target = destination(options.dir, found.payload, { suite: options.suite });
      // oxlint-disable-next-line no-await-in-loop -- keeps each file's import and copy paired, so a failure leaves no orphan copy.
      await Bun.write(target, Bun.file(found.path));
      collected.push(target);
    }
    return collected;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const argv = cli({
    name: "collect-ci-runs",
    parameters: ["[run-ids...]"],
    help: {
      description:
        "Download promptfoo exports from eval workflow runs, import them locally, and file them under evals/results/.",
    },
    flags: {
      workflow: {
        type: String,
        default: DEFAULT_WORKFLOW,
        description: "Workflow file to collect from",
      },
      limit: {
        type: Number,
        default: 5,
        description: "Runs to collect when no run id is given",
      },
      conclusion: {
        type: String,
        default: "success",
        description: 'Conclusion to collect, or "any"',
      },
      repo: { type: String, description: "OWNER/REPO (defaults to the current checkout)" },
      suite: { type: String, description: "Suite directory override" },
      resultsDir: { type: String, description: "Results corpus root (default evals/results)" },
    },
  });

  const dir = resultsDir(argv.flags.resultsDir);
  const explicit = argv._.runIds.map(Number);
  if (explicit.some((id) => !Number.isInteger(id))) {
    console.error("Run ids must be integers.");
    process.exit(1);
  }

  const runIds =
    explicit.length > 0
      ? explicit
      : selectRuns(
          await listRuns(argv.flags.workflow, argv.flags.limit, { repo: argv.flags.repo }),
          {
            limit: argv.flags.limit,
            conclusion: argv.flags.conclusion,
          },
        ).map((run) => run.databaseId);

  if (runIds.length === 0) {
    console.log(`No ${argv.flags.conclusion} runs of ${argv.flags.workflow} to collect.`);
    process.exit(0);
  }

  for (const runId of runIds) {
    // oxlint-disable-next-line no-await-in-loop -- gh downloads and promptfoo imports share state; running them in sequence keeps the output readable.
    const collected = await collectRun(runId, {
      dir,
      repo: argv.flags.repo,
      suite: argv.flags.suite,
    });
    console.log(`${runId}: ${collected.length} export(s)`);
    for (const file of collected) console.log(`  ${file}`);
  }
}
