#!/usr/bin/env bun

import { $ } from "bun";
import { cli } from "cleye";
import { type DiffOptions, resolveDiff } from "../../../detection/diff";
import { extractComments, languageForPath } from "../../../detection/extract";
import { scopeIntroduced } from "../../../detection/scope";
import { detectTells, type Tell } from "../../../detection/tells";
import type { Comment, FileDiff, IntroducedComment } from "../../../detection/types";
import {
  type AnthropicJudgeOptions,
  anthropicCommentJudge,
  type CommentJudgeInput,
  judgeComments,
  loadPrompt,
} from "../../../judge/judge";
import type { Verdict } from "../../../judge/schema";

/** Source lines of context on each side of a comment, for the what-on-dense call. */
const CONTEXT_LINES = 8;

/** ANSI colors (0-15) remap under the terminal theme, so they adapt to light/dark. */
const color = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
};

/**
 * The new version of a changed file. Local modes read the working tree (it
 * reflects HEAD plus uncommitted work). An MR is fetched from its source ref.
 */
async function newFileContent(
  path: string,
  options: DiffOptions,
  mrSource: MrSource | null,
): Promise<string | null> {
  if (options.mr && mrSource) {
    const encoded = encodeURIComponent(path);
    const raw =
      await $`glab api projects/${mrSource.projectId}/repository/files/${encoded}/raw?ref=${mrSource.ref}`
        .quiet()
        .nothrow();
    return raw.exitCode === 0 ? raw.text() : null;
  }
  const file = Bun.file(path);
  return (await file.exists()) ? file.text() : null;
}

interface MrSource {
  projectId: string;
  ref: string;
}

async function resolveMrSource(iid: string): Promise<MrSource | null> {
  const result = await $`glab mr view ${iid} -F json`.quiet().nothrow();
  if (result.exitCode !== 0) return null;
  const record = JSON.parse(result.text()) as Record<string, unknown>;
  const projectId = record.source_project_id;
  const diffRefs = record.diff_refs as Record<string, unknown> | undefined;
  const ref = diffRefs?.head_sha ?? record.sha;
  if (projectId == null || typeof ref !== "string") return null;
  return { projectId: String(projectId), ref };
}

/** Build the line-numbered window of source the judge reads around a comment. */
function contextWindow(source: string, comment: Comment): string {
  const lines = source.split("\n");
  const start = Math.max(1, comment.startLine - CONTEXT_LINES);
  const end = Math.min(lines.length, comment.endLine + CONTEXT_LINES);
  const out: string[] = [];
  for (let n = start; n <= end; n++) out.push(`${n}: ${lines[n - 1]}`);
  return out.join("\n");
}

interface Finding {
  comment: IntroducedComment;
  context: string;
  tells: Tell[];
}

/** Extract and scope the introduced comments in one changed file. */
async function collectFile(
  file: FileDiff,
  options: DiffOptions,
  mrSource: MrSource | null,
): Promise<Finding[]> {
  const language = languageForPath(file.path);
  if (!language || file.added.length === 0) return [];
  const source = await newFileContent(file.path, options, mrSource);
  if (source == null) {
    console.error(color.dim(`skipped ${file.path}: could not read new file content`));
    return [];
  }
  const comments = await extractComments(source, language);
  return scopeIntroduced(comments, file.added).map((comment) => ({
    comment: { ...comment, path: file.path, language },
    context: contextWindow(source, comment),
    tells: detectTells(comment),
  }));
}

/** Collect the introduced comments across every changed file, reading files concurrently. */
async function collectFindings(
  diffs: FileDiff[],
  options: DiffOptions,
  mrSource: MrSource | null,
): Promise<Finding[]> {
  const perFile = await Promise.all(diffs.map((file) => collectFile(file, options, mrSource)));
  return perFile.flat();
}

function toJudgeInput(finding: Finding): CommentJudgeInput {
  return {
    path: finding.comment.path,
    language: finding.comment.language,
    kind: finding.comment.kind,
    text: finding.comment.text,
    context: finding.context,
  };
}

function render(findings: Finding[], verdicts: Verdict[], fix: boolean): string {
  const flagged = findings
    .map((finding, i) => ({ finding, verdict: verdicts[i] }))
    .filter((pair): pair is { finding: Finding; verdict: Verdict } =>
      Boolean(pair.verdict?.isSlop),
    );
  if (flagged.length === 0) return color.dim("No slop comments found in the introduced comments.");

  const byFile = new Map<string, Array<{ finding: Finding; verdict: Verdict }>>();
  for (const pair of flagged) {
    const list = byFile.get(pair.finding.comment.path) ?? [];
    list.push(pair);
    byFile.set(pair.finding.comment.path, list);
  }

  const blocks: string[] = [];
  for (const [path, pairs] of byFile) {
    const lines = [color.bold(path)];
    for (const { finding, verdict } of pairs) {
      const advisory = finding.tells.length
        ? color.yellow(` [${finding.tells.map((t) => t.id).join(",")}]`)
        : "";
      const conf =
        verdict.confidence === "high" ? color.red(verdict.confidence) : verdict.confidence;
      lines.push(
        `  ${color.dim(`:${finding.comment.startLine}`)}  ${verdict.category}  ${conf}${advisory}`,
      );
      lines.push(`      ${verdict.rationale}`);
      if (fix && verdict.suggestedFix) lines.push(color.dim(`      fix: ${verdict.suggestedFix}`));
      if (verdict.trimToLines?.length) {
        lines.push(color.dim(`      keep lines: ${verdict.trimToLines.join(", ")}`));
      }
    }
    blocks.push(lines.join("\n"));
  }
  return blocks.join("\n\n");
}

const argv = cli({
  name: "audit",
  flags: {
    base: {
      type: String,
      description: "Judge comments introduced vs the merge-base with this ref",
    },
    mr: { type: String, description: "Judge comments introduced by a GitLab merge request (iid)" },
    fix: {
      type: Boolean,
      default: false,
      description: "Include a concrete suggestion per finding",
    },
    model: { type: String, description: "Override the judge model" },
  },
});

const options: DiffOptions = {};
if (argv.flags.base) options.base = argv.flags.base;
if (argv.flags.mr) options.mr = argv.flags.mr;
const mrSource = argv.flags.mr ? await resolveMrSource(argv.flags.mr) : null;
if (argv.flags.mr && !mrSource) {
  console.error("Could not resolve the merge request's source ref via glab.");
  process.exit(1);
}

const diffs = await resolveDiff(options);
const findings = await collectFindings(diffs, options, mrSource);
if (findings.length === 0) {
  console.log(color.dim("No introduced comments to judge."));
  process.exit(0);
}

const base = await loadPrompt();
const promptText = argv.flags.fix
  ? `${base.text}\n\nFor this run, populate suggestedFix for every flagged comment with a concrete rewrite, trim, or delete.`
  : base.text;
console.error(
  color.dim(
    `Judging ${findings.length} introduced comment(s) (prompt ${base.sha256.slice(0, 12)})`,
  ),
);
const judgeOptions: AnthropicJudgeOptions = { prompt: promptText };
if (argv.flags.model) judgeOptions.model = argv.flags.model;
const judge = anthropicCommentJudge(judgeOptions);
const verdicts = await judgeComments(judge, findings.map(toJudgeInput));
console.log(render(findings, verdicts, argv.flags.fix));
