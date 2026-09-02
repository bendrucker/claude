import { basename, join } from "node:path";
import { z } from "zod";
import { applyToBranch, isCleanTree } from "../../../apply/branch";
import { computeFileEdits, type EditItem } from "../../../apply/edits";
import { formatContent } from "../../../apply/format";
import { collectVerdicts, matchVerdicts } from "../../../apply/join";
import { color, type ReportItem, renderReport, summarize } from "../../../apply/report";
import { extractComments, languageForPath } from "../../../detection/extract";
import type { Comment } from "../../../detection/types";
import { verdictPath } from "../../../judge/adapter";
import { readShard, type ShardRef } from "../../../judge/job";
import type { Verdict } from "../../../judge/schema";
import { AuditError, type AuditIo } from "./io";

export interface ApplyOptions {
  /** The job dir preflight printed. */
  job: string;
  /** Prints findings only. */
  report: boolean;
  /** Include suggestions in the report. */
  fix: boolean;
  /** Shell template to format each edited file through (`{}` = path, content on stdin). */
  format?: string | undefined;
  /** Refuse a splice past this line width. Unchecked when omitted. */
  maxWidth?: number | undefined;
}

export interface ApplyResult {
  items: ReportItem[];
  /** New content per edited path, after formatting. */
  edits: Map<string, string>;
  /** The branch the edits landed on, or null in report mode or with nothing to apply. */
  branch: string | null;
  /** Verdict ids whose comment no longer re-extracts at its preflight position. */
  drift: string[];
  /** `path:line  detail` for each edit the applier refused. */
  manual: string[];
}

function toEditItem(comment: Comment, verdict: Verdict): EditItem {
  return {
    startLine: comment.startLine,
    endLine: comment.endLine,
    startColumn: comment.startColumn,
    endColumn: comment.endColumn,
    kind: comment.kind,
    verdict,
  };
}

async function readJson<T = unknown>(path: string, schema: z.ZodType<T>): Promise<T> {
  return schema.parse(JSON.parse(await Bun.file(path).text()));
}

const JobArgsFile = z.looseObject({
  shards: z.array(z.looseObject({ id: z.number(), path: z.string() })),
});

const Scope = z.looseObject({ mr: z.string().nullish() });

/** The shards preflight wrote, from the args it handed the workflow. */
async function readShardRefs(jobDir: string): Promise<ShardRef[]> {
  const argsPath = join(jobDir, "job-args.json");
  if (!(await Bun.file(argsPath).exists())) {
    throw new AuditError(`No job at ${jobDir}. Pass the job dir printed by preflight.`);
  }
  return (await readJson(argsPath, JobArgsFile)).shards;
}

/** The files a job judged, recovered from its shards. */
async function judgedPaths(shards: ShardRef[]): Promise<string[]> {
  const paths = new Set<string>();
  for (const shard of await Promise.all(shards.map((ref) => readShard(ref.path)))) {
    for (const comment of shard.comments) paths.add(comment.path);
  }
  return [...paths];
}

/**
 * Every shard's verdict file. A shard whose agent never wrote one fails the run
 * rather than reading as drift.
 */
async function readVerdicts(jobDir: string, shards: ShardRef[]): Promise<Map<string, Verdict>> {
  const verdictsDir = join(jobDir, "verdicts");
  const files = shards.map((ref) => ({ id: ref.id, path: verdictPath(verdictsDir, ref.id) }));
  const present = await Promise.all(files.map((file) => Bun.file(file.path).exists()));
  const missing = files.filter((_, i) => !present[i]).map((file) => file.id);
  if (missing.length > 0) {
    throw new AuditError(
      `No verdicts for shard(s) ${missing.join(", ")} in ${verdictsDir}. Run the judge workflow first.`,
    );
  }
  return collectVerdicts(await Promise.all(files.map((file) => readJson(file.path, z.unknown()))));
}

async function guardScope(options: ApplyOptions): Promise<void> {
  const scopePath = join(options.job, "scope.json");
  const scope = (await Bun.file(scopePath).exists())
    ? await readJson(scopePath, Scope)
    : { mr: null };
  if (scope.mr != null && scope.mr !== "" && !options.report) {
    throw new AuditError(
      `This job audited merge request !${scope.mr} from its remote source. Apply writes trims to the local tree from HEAD, so every comment would read as drift. Re-run with --report, or check out the MR branch and re-run preflight with --base.`,
    );
  }
}

/**
 * Re-extract each judged file, match the verdicts to comments by id at their
 * current range, and either print the findings or land the edits on a fresh
 * branch off HEAD. Runs from the repo root.
 */
export async function apply(options: ApplyOptions, io: AuditIo): Promise<ApplyResult> {
  const shards = await readShardRefs(options.job);
  await guardScope(options);
  const verdicts = await readVerdicts(options.job, shards);

  const items: ReportItem[] = [];
  const edits = new Map<string, string>();
  const matched = new Set<string>();
  const manual: string[] = [];
  const skippedComments = new Set<string>();

  // A verdict whose id no longer re-extracts has drifted.
  for (const path of await judgedPaths(shards)) {
    const language = languageForPath(path);
    const file = Bun.file(path);
    // oxlint-disable-next-line no-await-in-loop -- the report lists findings in judged-path order and the body threads shared accumulators.
    if (language == null || language === "" || !(await file.exists())) continue;
    // oxlint-disable-next-line no-await-in-loop -- the report lists findings in judged-path order and the body threads shared accumulators.
    const source = await file.text();
    const editItems: EditItem[] = [];
    // oxlint-disable-next-line no-await-in-loop -- the report lists findings in judged-path order and the body threads shared accumulators.
    for (const match of matchVerdicts(path, await extractComments(source, language), verdicts)) {
      matched.add(match.id);
      items.push({
        path,
        startLine: match.comment.startLine,
        verdict: match.verdict,
        text: match.comment.text,
      });
      if (match.verdict.action !== "keep") editItems.push(toEditItem(match.comment, match.verdict));
    }
    if (editItems.length > 0) {
      const result = computeFileEdits(source, editItems, { maxWidth: options.maxWidth });
      for (const skip of result.skips) {
        manual.push(`${path}:${skip.startLine}  ${skip.detail}`);
        skippedComments.add(`${path}:${skip.startLine}`);
      }
      if (result.content !== source) edits.set(path, result.content);
    }
  }

  if (options.format != null && options.format !== "" && !options.report) {
    for (const [path, content] of edits) {
      // oxlint-disable-next-line no-await-in-loop -- bounds formatter subprocess fan-out to one `sh -c` per edited file at a time.
      const formatted = await formatContent(options.format, path, content);
      if (formatted.formatted) {
        edits.set(path, formatted.content);
      } else {
        io.warn(
          color.yellow(
            `Formatter failed for ${path} (${formatted.error}); keeping unformatted content.`,
          ),
        );
      }
    }
  }

  for (const item of items) {
    if (skippedComments.has(`${item.path}:${item.startLine}`)) item.skipped = true;
  }

  const drift = [...verdicts.keys()].filter((id) => !matched.has(id));

  let branch: string | null = null;
  if (options.report) {
    io.log(renderReport(items, { fix: options.fix }));
  } else if (edits.size === 0) {
    io.log(color.dim("Nothing to apply."));
  } else if (!(await isCleanTree())) {
    throw new AuditError(
      "Working tree is not clean. Commit or stash before applying, or use --report.",
    );
  } else {
    branch = `comments/audit-${basename(options.job)}`;
    await applyToBranch(edits, { branch });
    io.log(
      `Applied ${summarize(items)} on branch ${color.bold(branch)}. Review with git diff HEAD..${branch}.`,
    );
  }

  if (drift.length > 0) {
    io.warn(
      color.yellow(
        `Skipped ${drift.length} judged comment(s) no longer found at preflight position (file changed since preflight).`,
      ),
    );
  }
  if (manual.length > 0) {
    io.warn(color.yellow(`Left ${manual.length} comment(s) for manual handling:`));
    for (const skip of manual) io.warn(`  ${skip}`);
  }

  return { items, edits, branch, drift, manual };
}
