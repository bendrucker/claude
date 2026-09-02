#!/usr/bin/env bun

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { cli } from "cleye";
import { decodeFile } from "../../packages/decode/index";
import { expectSuccess, type RunCommand, runCommand } from "./command";
import { exportEval } from "./promptfoo";
import { destination, ExportPayload, resultsDir, runCost, slug } from "./results";

export const S3_DESTINATION = "s3://ben-drucker-agents-eval-corpus/eval-results/";

export const NO_CREDENTIALS_NOTICE =
  "AWS credentials unavailable: skipping the S3 sync. The export stays in evals/results/.";

export const UNAUTHORIZED_NOTICE =
  "AWS credentials lack access to the corpus bucket: skipping the S3 sync. The export stays in evals/results/.";

const AUTHORIZATION_FAILURES = ["AccessDenied", "InvalidAccessKeyId", "ExpiredToken"];

/**
 * A signed-in shell holding the wrong role passes the sts probe and fails at the
 * first bucket call, so the refusal has to be recognized from the sync's stderr.
 */
export function isUnauthorized(stderr: string): boolean {
  return AUTHORIZATION_FAILURES.some((code) => stderr.includes(code));
}

export interface ExportRunOptions {
  evalId: string;
  dir: string;
  suite?: string | undefined;
  date?: string | undefined;
  run?: RunCommand | undefined;
  bin?: string | undefined;
}

export interface ExportedRun {
  path: string;
  payload: ExportPayload;
}

// "latest" is whatever ran most recently in the shared promptfoo database, which
// every suite writes, so filing it under --suite requires the payload to identify
// itself as that suite through its config description.
export function assertSuiteMatch(payload: ExportPayload, suite: string): void {
  const description = payload.config?.description;
  if (description !== undefined && slug(description).startsWith(slug(suite))) return;
  throw new Error(
    `Latest eval ${payload.evalId} (${description ?? "no description"}) is not a ${suite} run: pass its eval id explicitly`,
  );
}

export async function exportRun(options: ExportRunOptions): Promise<ExportedRun> {
  const staging = await mkdtemp(path.join(tmpdir(), "eval-export-"));
  const staged = path.join(staging, "export.json");
  try {
    await exportEval(options.evalId, staged, { run: options.run, bin: options.bin });

    const payload = await decodeFile(ExportPayload, staged);
    const target = destination(options.dir, payload, {
      suite: options.suite,
      date: options.date,
    });

    if (options.evalId === "latest" && options.suite !== undefined) {
      assertSuiteMatch(payload, options.suite);
    }

    await Bun.write(target, Bun.file(staged));
    return { path: target, payload };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function hasAwsCredentials(run: RunCommand = runCommand): Promise<boolean> {
  const probe = await run(["aws", "sts", "get-caller-identity", "--output", "json"]);
  return probe.code === 0;
}

export function syncCommand(dir: string, target: string): string[] {
  return ["aws", "s3", "sync", dir, target, "--exclude", ".DS_Store"];
}

export type SyncOutcome = "synced" | "no-credentials" | "unauthorized";

export function syncNotice(outcome: SyncOutcome, dir: string, target: string): string {
  if (outcome === "no-credentials") return NO_CREDENTIALS_NOTICE;
  if (outcome === "unauthorized") return UNAUTHORIZED_NOTICE;
  return `Synced ${dir} to ${target}`;
}

export async function syncResults(
  dir: string,
  target: string,
  run: RunCommand = runCommand,
): Promise<SyncOutcome> {
  if (!(await hasAwsCredentials(run))) return "no-credentials";
  const command = syncCommand(dir, target);
  const result = await run(command);
  if (result.code !== 0 && isUnauthorized(result.stderr)) return "unauthorized";
  expectSuccess(command, result);
  return "synced";
}

if (import.meta.main) {
  const argv = cli({
    name: "export-run",
    parameters: ["[eval-id]"],
    help: {
      description:
        "Export a promptfoo eval to evals/results/<suite>/<date>-<id>.json, optionally syncing the corpus to S3.",
    },
    flags: {
      suite: {
        type: String,
        description: "Suite directory (defaults to a slug of the config description)",
      },
      date: {
        type: String,
        description: "YYYY-MM-DD override for a payload with no run timestamp",
      },
      resultsDir: {
        type: String,
        description: "Results corpus root (default evals/results)",
      },
      sync: {
        type: Boolean,
        description: `Sync the corpus to ${S3_DESTINATION} after exporting`,
      },
      s3: {
        type: String,
        default: S3_DESTINATION,
        description: "S3 destination for --sync",
      },
    },
  });

  const dir = resultsDir(argv.flags.resultsDir);
  const exported = await exportRun({
    evalId: argv._.evalId ?? "latest",
    dir,
    suite: argv.flags.suite,
    date: argv.flags.date,
  });
  console.log(`${exported.payload.evalId}  $${runCost(exported.payload).toFixed(2)}`);
  console.log(exported.path);

  if (argv.flags.sync) {
    const outcome = await syncResults(dir, argv.flags.s3);
    console.log(syncNotice(outcome, dir, argv.flags.s3));
  }
}
