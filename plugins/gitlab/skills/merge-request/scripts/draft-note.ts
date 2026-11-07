#!/usr/bin/env bun

import { cli, command } from "cleye";
import { z } from "zod";
import { errorText, projectPath } from "../../../scripts/merge";

const Line = z.union([z.number().int().positive(), z.string().regex(/^\d+(:\d+)?$/)]);

export const Entry = z.looseObject({
  body: z.string().min(1),
  file: z.string().optional(),
  line: Line.optional(),
  oldLine: z.number().int().positive().optional(),
  replyTo: z.string().optional(),
  resolve: z.boolean().optional(),
});
export type Entry = z.infer<typeof Entry>;

export interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}
export type Run = (args: string[], stdin?: string) => Promise<RunResult>;

export interface ReviewOptions {
  iid: string;
  repo?: string | undefined;
  submit: boolean;
  approve: boolean;
  requestChanges: boolean;
  summary?: string | undefined;
  sha?: string | undefined;
}

export const spawnGlab: Run = async (args, stdin) => {
  const proc = Bun.spawn(["glab", ...args], {
    stdin: stdin == null ? "ignore" : new Blob([stdin]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { ok: code === 0, stdout: stdout.trim(), stderr: stderr.trim() };
};

function repoArgs(repo?: string): string[] {
  return repo == null || repo === "" ? [] : ["-R", repo];
}

export function validateOptions(opts: {
  iid: string;
  submit: boolean;
  approve: boolean;
  requestChanges: boolean;
  summary?: string | undefined;
  summaryFile?: string | undefined;
}): string | null {
  if (!/^\d+$/.test(opts.iid)) return `Invalid MR iid: ${opts.iid}`;
  if (opts.approve && opts.requestChanges) return "--approve and --request-changes conflict";
  if (opts.summary != null && opts.summaryFile != null) {
    return "--summary and --summary-file conflict";
  }
  const hasSummary = opts.summary != null || opts.summaryFile != null;
  if (!opts.submit && (opts.approve || opts.requestChanges || hasSummary)) {
    return "--approve, --request-changes, and the summary flags require --submit";
  }
  return null;
}

export function validateEntry(entry: Entry): string | null {
  const hasFile = entry.file != null && entry.file !== "";
  const hasReply = entry.replyTo != null && entry.replyTo !== "";
  if (hasFile && hasReply) return "file and replyTo conflict";
  if (entry.line != null && entry.oldLine != null) return "line and oldLine conflict";
  if ((entry.line != null || entry.oldLine != null) && !hasFile)
    return "line and oldLine need file";
  if (entry.resolve && !hasReply) return "resolve needs replyTo";
  return null;
}

// Native `draft create` reads the body from stdin and has no resolve flag, so a
// reply that resolves its thread goes through the REST draft_notes endpoint.
export function createArgs(iid: string, entry: Entry, repo?: string): string[] {
  if (entry.resolve) {
    return [
      "api",
      `${projectPath(repo)}/merge_requests/${iid}/draft_notes`,
      "-X",
      "POST",
      "-f",
      `note=${entry.body}`,
      "-f",
      `in_reply_to_discussion_id=${entry.replyTo ?? ""}`,
      "-f",
      "resolve_discussion=true",
    ];
  }
  const args = ["mr", "note", "draft", "create", iid];
  if (entry.file != null && entry.file !== "") args.push("--file", entry.file);
  if (entry.line != null) args.push("--line", String(entry.line));
  if (entry.oldLine != null) args.push("--old-line", String(entry.oldLine));
  if (entry.replyTo != null && entry.replyTo !== "") args.push("--reply", entry.replyTo);
  return [...args, ...repoArgs(repo)];
}

export function publishArgs(opts: ReviewOptions): string[] {
  const args = ["mr", "note", "draft", "publish", opts.iid, "--yes"];
  if (opts.summary != null && opts.summary !== "") args.push("-m", opts.summary);
  if (opts.requestChanges) args.push("--reviewer-state", "requested_changes");
  return [...args, ...repoArgs(opts.repo)];
}

export function approveArgs(opts: ReviewOptions): string[] {
  const args = ["mr", "approve", opts.iid];
  if (opts.sha != null && opts.sha !== "") args.push("--sha", opts.sha);
  return [...args, ...repoArgs(opts.repo)];
}

function failureText(result: RunResult): string {
  return result.stderr !== "" ? result.stderr : result.stdout;
}

function label(entry: Entry): string {
  return entry.file ?? (entry.replyTo == null ? "general" : `reply ${entry.replyTo}`);
}

// Nothing is published or approved after a failed entry.
export async function runReview(
  entries: Entry[],
  opts: ReviewOptions,
  run: Run = spawnGlab,
): Promise<number> {
  let failed = 0;
  for (const entry of entries) {
    // oxlint-disable-next-line no-await-in-loop -- one glab call per draft keeps the failure lines in entry order.
    const result = await run(
      createArgs(opts.iid, entry, opts.repo),
      entry.resolve ? undefined : entry.body,
    );
    if (!result.ok) {
      console.error(`Failed: ${label(entry)}: ${failureText(result)}`);
      failed++;
    }
  }

  console.error(`Created ${entries.length - failed} draft notes (${failed} failed)`);
  if (failed > 0) {
    if (opts.submit) console.error("Skipping publish and approve");
    return 1;
  }
  if (!opts.submit) return 0;

  const published = await run(publishArgs(opts));
  if (!published.ok) {
    console.error(`Publish failed: ${failureText(published)}`);
    return 1;
  }
  console.error("Published draft notes");

  if (opts.approve) {
    const approved = await run(approveArgs(opts));
    if (!approved.ok) {
      console.error(`Approve failed: ${failureText(approved)}`);
      return 1;
    }
    console.error("Approved MR");
  }
  return 0;
}

const reviewCmd = command(
  {
    name: "review",
    parameters: ["<iid>"],
    flags: {
      input: { type: String, description: "JSON file with review entries" },
      repo: { type: String, alias: "R", description: "Target group/project" },
      submit: { type: Boolean, default: false, description: "Publish the drafts after creating" },
      approve: { type: Boolean, default: false, description: "Approve after publishing" },
      requestChanges: {
        type: Boolean,
        default: false,
        description: "Set the reviewer state to requested_changes when publishing",
      },
      summary: { type: String, description: "Summary note posted with the publish" },
      summaryFile: { type: String, description: "Read the summary from a file" },
      sha: { type: String, description: "Approve only if the MR head matches this SHA" },
    },
  },
  async (argv) => {
    const { flags } = argv;
    const invalid = validateOptions({ iid: argv._.iid, ...flags });
    if (invalid != null) throw new Error(invalid);
    if (flags.input == null || flags.input === "") throw new Error("--input is required");

    const entries = z.array(Entry).parse(JSON.parse(await Bun.file(flags.input).text()));
    const problems = entries
      .map((entry, index) => [index, validateEntry(entry)] as const)
      .filter(([, problem]) => problem != null)
      .map(([index, problem]) => `entry ${index}: ${problem}`);
    if (problems.length > 0) throw new Error(problems.join("\n"));

    const summary =
      flags.summaryFile == null ? flags.summary : await Bun.file(flags.summaryFile).text();
    process.exit(
      await runReview(entries, {
        iid: argv._.iid,
        repo: flags.repo,
        submit: flags.submit,
        approve: flags.approve,
        requestChanges: flags.requestChanges,
        summary,
        sha: flags.sha,
      }),
    );
  },
);

if (import.meta.main) {
  try {
    await cli({ name: "draft-note", commands: [reviewCmd] }, (parsed) => {
      parsed.showHelp();
      process.exit(1);
    });
  } catch (error) {
    console.error(errorText(error));
    process.exit(1);
  }
}
