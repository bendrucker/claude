import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { z } from "zod";
import { applyToBranch, isCleanTree } from "../../../apply/branch";
import { computeFileEdits, type EditItem } from "../../../apply/edits";
import { formatContent } from "../../../apply/format";
import { collectVerdicts, matchVerdicts } from "../../../apply/join";
import { color, type ReportItem, renderReport, summarize } from "../../../apply/report";
import { extractComments, languageForPath } from "../../../detection/extract";
import type { Comment } from "../../../detection/types";
import type { Verdict } from "../../../judge/schema";
import { AuditError, type AuditIo } from "./io";

export interface ApplyOptions {
  /** The job dir preflight printed. */
  job: string;
  /** Print findings instead of applying. */
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

async function readJsonFiles<T = unknown>(
  dir: string,
  prefix: string,
  schema: z.ZodType<T>,
): Promise<T[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const matching = names.filter((name) => name.startsWith(prefix) && name.endsWith(".json"));
  return Promise.all(
    matching.map(async (name) => schema.parse(JSON.parse(await Bun.file(join(dir, name)).text()))),
  );
}

const Scope = z.looseObject({ mr: z.string().nullish() });

const ShardPaths = z.looseObject({ comments: z.array(z.looseObject({ path: z.string() })) });

/** The files a job judged, recovered from its shards. */
async function judgedPaths(jobDir: string): Promise<string[]> {
  const shards = await readJsonFiles(jobDir, "shard-", ShardPaths);
  const paths = new Set<string>();
  for (const shard of shards) for (const comment of shard.comments) paths.add(comment.path);
  return [...paths];
}

async function readVerdicts(jobDir: string): Promise<Map<string, Verdict>> {
  const verdictsDir = join(jobDir, "verdicts");
  const shards = await readJsonFiles(verdictsDir, "verdict-", z.unknown());
  if (shards.length === 0) {
    throw new AuditError(`No verdicts in ${verdictsDir}. Run the judge workflow first.`);
  }
  return collectVerdicts(shards);
}

async function guardScope(options: ApplyOptions): Promise<void> {
  if (!(await Bun.file(join(options.job, "job-args.json")).exists())) {
    throw new AuditError(`No job at ${options.job}. Pass the job dir printed by preflight.`);
  }
  const scopeFile = Bun.file(join(options.job, "scope.json"));
  const scope = (await scopeFile.exists())
    ? Scope.parse(JSON.parse(await scopeFile.text()))
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
  await guardScope(options);
  const verdicts = await readVerdicts(options.job);

  const items: ReportItem[] = [];
  const edits = new Map<string, string>();
  const matched = new Set<string>();
  const manual: string[] = [];
  const skippedComments = new Set<string>();

  // A verdict whose id no longer re-extracts has drifted.
  for (const path of await judgedPaths(options.job)) {
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
