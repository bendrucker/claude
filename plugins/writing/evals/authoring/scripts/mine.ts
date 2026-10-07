#!/usr/bin/env bun
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Command, InvalidArgumentError } from "@commander-js/extra-typings";
import type { Image, Link, Nodes } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { visit } from "unist-util-visit";
import { z } from "zod";
import { decodeJson } from "../../../../../packages/decode/index";
import { mapPool } from "./pool";

// GitHub's secondary rate limit penalizes concurrent requests from one token.
const GITHUB_CONCURRENCY = 1;

// Candidate briefs from public repos, restricted to hand-written deliverables: created before
// 2025-02-24, or after 2026-06-30 with no indexed session touching them. The index probe is
// scoped to host = 'local'.

export const PRE_CLAUDE_CODE = "2025-02-24T00:00:00Z";
export const POST_WINDOW = "2026-06-30T00:00:00Z";
export const EARLIEST_MINING_DATE = "2005-01-01T00:00:00Z";

const AI_MARKER_PATTERNS = [/\bclaude\b/i, /generated with/i, /co-authored-by/i];

export type Surface = "pr" | "issue" | "doc" | "skill";
export type SplitTag = "dev" | "holdout";

export interface DiffStats {
  files: number;
  changedLines: number;
  binaryFiles: number;
}

export interface Candidate {
  id: string;
  surface: Surface;
  repo: string;
  ref: string;
  createdAt: string;
  url: string;
  summary: string;
  diff: DiffStats;
  notes: string;
  body: string;
}

export interface SplitCandidate extends Candidate {
  split: SplitTag;
  balance: boolean;
}

export function isPreClaudeCode(createdAt: string): boolean {
  return Date.parse(createdAt) < Date.parse(PRE_CLAUDE_CODE);
}

export function isPostWindow(createdAt: string): boolean {
  return Date.parse(createdAt) >= Date.parse(POST_WINDOW);
}

export function isEligibleDate(createdAt: string): boolean {
  return isPreClaudeCode(createdAt) || isPostWindow(createdAt);
}

export function hasAiMarkers(text: string): boolean {
  return AI_MARKER_PATTERNS.some((pattern) => pattern.test(text));
}

// Length of the body with HTML-comment template scaffolding stripped, so an
// unfilled PR template (all comments, no prose) doesn't pass the length bar.
export function proseLength(body: string): number {
  return body.replaceAll(/<!--[\s\S]*?-->/g, "").trim().length;
}

const BINARY_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "ico",
  "pdf",
  "zip",
  "gz",
  "tar",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "eot",
  "mp4",
  "mov",
  "wasm",
  "bin",
  "exe",
  "dylib",
  "so",
  "dll",
]);

export function isBinaryPath(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return BINARY_EXTENSIONS.has(ext);
}

export const DEFAULT_DIFF_BUDGET = { maxFiles: 10, maxLines: 400 };

export function fitsDiffBudget(
  stats: DiffStats,
  budget: { maxFiles: number; maxLines: number } = DEFAULT_DIFF_BUDGET,
): boolean {
  return (
    stats.files <= budget.maxFiles &&
    stats.changedLines <= budget.maxLines &&
    stats.binaryFiles === 0
  );
}

export function countWordsAdded(patch: string): number {
  let words = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++") || !line.startsWith("+")) continue;
    const text = line.slice(1).trim();
    if (text === "") continue;
    words += text.split(/\s+/).filter(Boolean).length;
  }
  return words;
}

const TABLE_ROW = /^\s*\|.*\|\s*$/;

type Range = [number, number];

function isBadge(node: Link | Image): boolean {
  return node.type === "image" || node.children.every((child) => child.type === "image");
}

function proseCuts(markdown: string): Range[] {
  const cuts: Range[] = [];
  const cut = (node: Nodes) => {
    const { start, end } = node.position ?? {};
    if (start?.offset !== undefined && end?.offset !== undefined)
      cuts.push([start.offset, end.offset]);
  };
  visit(fromMarkdown(markdown), (node) => {
    if (node.type === "code") cut(node);
    else if ((node.type === "link" || node.type === "image") && isBadge(node)) cut(node);
    else if (node.type === "paragraph" && node.position !== undefined) {
      let offset = node.position.start.offset ?? 0;
      const paragraph = markdown.slice(offset, node.position.end.offset);
      for (const line of paragraph.split("\n")) {
        if (TABLE_ROW.test(line)) cuts.push([offset, offset + line.length]);
        offset += line.length + 1;
      }
    }
  });
  return cuts;
}

/** Removes each range, along with its whole lines when nothing else shares them. */
function cutRanges(text: string, ranges: Range[]): string {
  let out = "";
  let at = 0;
  for (const [from, to] of ranges.toSorted((a, b) => a[0] - b[0])) {
    if (to <= at) continue;
    const lineStart = text.lastIndexOf("\n", from - 1) + 1;
    const lineEndIndex = text.indexOf("\n", to);
    const lineEnd = lineEndIndex === -1 ? text.length : lineEndIndex;
    const alone =
      text.slice(Math.max(lineStart, at), from).trim() === "" &&
      text.slice(to, lineEnd).trim() === "";
    const startAt = alone ? Math.max(lineStart, at) : Math.max(from, at);
    out += text.slice(at, startAt);
    at = alone ? Math.min(lineEnd + 1, text.length) : to;
  }
  return out + text.slice(at);
}

// Added prose in a patch, minus code blocks, badge images, and table rows.
export function extractAddedProse(patch: string): string {
  const added: string[] = [];
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++") || !line.startsWith("+")) continue;
    added.push(line.slice(1));
  }
  const markdown = added.join("\n");
  return cutRanges(markdown, proseCuts(markdown))
    .replaceAll(/\n{3,}/g, "\n\n")
    .trim();
}

export function countProseWordsAdded(patch: string): number {
  const prose = extractAddedProse(patch);
  return prose === "" ? 0 : prose.split(/\s+/).filter(Boolean).length;
}

function countPlainWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

// Older README commits often have a terse message, so fall back to the diff's added prose.
export function candidateBody(
  message: string,
  targetFiles: { filename: string; patch?: string | undefined }[],
  minWords: number,
): string {
  if (countPlainWords(message) >= minWords) return message;
  const extracted = targetFiles
    .map((f) => extractAddedProse(f.patch ?? ""))
    .filter((text) => text.length > 0)
    .join("\n\n");
  return extracted.length > 0 ? extracted : message;
}

export function repoShortName(repo: string): string {
  return repo.split("/").pop() ?? repo;
}

// The repo's directory name appears as a path segment, with or without the owner prefix.
export function projectPathMatchesRepo(projectPath: string, repo: string): boolean {
  return projectPath.split("/").includes(repoShortName(repo));
}

export function withinHours(a: string, b: string, hours: number): boolean {
  return Math.abs(Date.parse(a) - Date.parse(b)) <= hours * 3_600_000;
}

function normalizeForMatch(text: string): string {
  return text.toLowerCase().replaceAll(/[`'"]/g, "").replaceAll(/\s+/g, " ").trim();
}

// Short needles are rejected rather than risking a false exclusion.
export function textAppearsInCommand(command: string, needle: string): boolean {
  const normalized = normalizeForMatch(needle);
  if (normalized.length < 8) return false;
  return normalizeForMatch(command).includes(normalized);
}

export interface ToolCallRow {
  project_path: string | null;
  timestamp: string;
  command: string | null;
  file_path: string | null;
}

export function hasMatchingCommand(
  rows: ToolCallRow[],
  repo: string,
  when: string,
  needle: string,
  hours = 24,
): boolean {
  return rows.some(
    (row) =>
      row.project_path != null &&
      row.command != null &&
      projectPathMatchesRepo(row.project_path, repo) &&
      withinHours(row.timestamp, when, hours) &&
      textAppearsInCommand(row.command, needle),
  );
}

export function hasTouchedFile(
  rows: ToolCallRow[],
  repo: string,
  when: string,
  pathSuffix: string,
  hours = 24,
): boolean {
  return rows.some(
    (row) =>
      row.project_path != null &&
      row.file_path != null &&
      projectPathMatchesRepo(row.project_path, repo) &&
      withinHours(row.timestamp, when, hours) &&
      row.file_path.endsWith(pathSuffix),
  );
}

// Interleave longest and shortest so the kept sample spans both substantial
// and terse deliverables instead of clustering at one length.
export function weave<T>(items: T[], length: (item: T) => number): T[] {
  const sorted = items.toSorted((a, b) => length(b) - length(a));
  const woven: T[] = [];
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo <= hi) {
    const first = sorted[lo++];
    if (first !== undefined) woven.push(first);
    if (lo <= hi) {
      const last = sorted[hi--];
      if (last !== undefined) woven.push(last);
    }
  }
  return woven;
}

// Repo-balanced round-robin, capped per repo, so one active repo doesn't
// crowd out the rest of a surface's sample.
export function selectSample<T extends { repo: string; body: string }>(
  candidates: T[],
  limit: number,
  maxPerRepo: number,
): T[] {
  const buckets = new Map<string, T[]>();
  for (const c of candidates) {
    const arr = buckets.get(c.repo) ?? [];
    arr.push(c);
    buckets.set(c.repo, arr);
  }
  for (const [repo, arr] of buckets) {
    buckets.set(
      repo,
      weave(arr, (i) => i.body.length),
    );
  }
  const order = [...buckets.keys()].toSorted();
  const taken = new Map<string, number>();
  const selected: T[] = [];
  let added = true;
  while (added && selected.length < limit) {
    added = false;
    for (const repo of order) {
      if ((taken.get(repo) ?? 0) >= maxPerRepo) continue;
      const next = buckets.get(repo)?.shift();
      if (next && selected.length < limit) {
        selected.push(next);
        taken.set(repo, (taken.get(repo) ?? 0) + 1);
        added = true;
      }
    }
  }
  return selected;
}

export function assignSplit<T>(items: T[]): (T & { split: SplitTag })[] {
  return items.map((item, i) => ({ ...item, split: i % 3 === 2 ? "holdout" : "dev" }));
}

// Balance candidates are routine, low-slop-risk changes.
export function markBalance<T extends { split: SplitTag }>(
  items: T[],
  count: number,
  weight: (item: T) => number,
): (T & { balance: boolean })[] {
  const devIndices = items
    .map((item, i) => ({ item, i }))
    .filter(({ item }) => item.split === "dev")
    .toSorted((a, b) => weight(a.item) - weight(b.item))
    .slice(0, count)
    .map(({ i }) => i);
  const balanced = new Set(devIndices);
  return items.map((item, i) => ({ ...item, balance: balanced.has(i) }));
}

const SURFACE_TITLES: Record<Surface, string> = {
  pr: "PR bodies",
  issue: "Issues",
  doc: "Docs/README",
  skill: "Skills",
};

function escapeCell(text: string): string {
  return text
    .replaceAll("|", String.raw`\|`)
    .replaceAll("\n", " ")
    .trim();
}

function splitLabel(item: SplitCandidate): string {
  return item.balance ? `${item.split} (balance)` : item.split;
}

function formatBriefsTable(items: SplitCandidate[]): string {
  const header = "| id | repo | number/sha | date | summary | diff size | split | notes |";
  const sep = "| --- | --- | --- | --- | --- | --- | --- | --- |";
  const rows = items.map((item) => {
    const date = item.createdAt.slice(0, 10);
    const diffSize = `${item.diff.files}f/${item.diff.changedLines}l`;
    return `| ${item.id} | ${item.repo} | ${item.ref} | ${date} | ${escapeCell(item.summary)} | ${diffSize} | ${splitLabel(item)} | ${escapeCell(item.notes)} |`;
  });
  return [header, sep, ...rows].join("\n");
}

export function renderBriefsMarkdown(
  bySurface: Map<Surface, SplitCandidate[]>,
  gaps: string[],
): string {
  const sections = [...bySurface.entries()]
    .filter(([, items]) => items.length > 0)
    .map(([surface, items]) => `## ${SURFACE_TITLES[surface]}\n\n${formatBriefsTable(items)}`);
  const gapsSection = `## Gaps\n\n${gaps.length > 0 ? gaps.map((g) => `- ${g}`).join("\n") : "- None."}`;
  return `${[...sections, gapsSection].join("\n\n")}\n`;
}

const LinkedPr = z.looseObject({ repository: z.string(), pr_number: z.number() });
const ToolCall = z.looseObject({
  project_path: z.string().nullable(),
  timestamp: z.string(),
  command: z.string().nullable(),
  file_path: z.string().nullable(),
});

async function queryDuckdb<T>(dbPath: string, sql: string, schema: z.ZodType<T>): Promise<T[]> {
  const proc = Bun.spawn(["duckdb", "-readonly", "-json", dbPath], {
    stdin: new TextEncoder().encode(sql),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`duckdb failed (${code}): ${err.trim()}`);
  const trimmed = out.trim();
  if (trimmed === "") return [];
  return decodeJson(z.array(schema), trimmed, `duckdb ${dbPath}`);
}

async function queryLinkedPrKeys(dbPath: string): Promise<Set<string>> {
  const rows = await queryDuckdb(
    dbPath,
    `SELECT DISTINCT repository, pr_number FROM pr_links WHERE host = 'local'`,
    LinkedPr,
  );
  return new Set(rows.map((r) => `${r.repository}#${r.pr_number}`));
}

async function queryToolCalls(dbPath: string, commandLike: string): Promise<ToolCallRow[]> {
  const sql = `
    SELECT project_path, timestamp, command, file_path
    FROM tool_calls
    WHERE host = 'local' AND command LIKE '${commandLike}'
  `;
  return queryDuckdb(dbPath, sql, ToolCall);
}

async function queryFileTouches(dbPath: string): Promise<ToolCallRow[]> {
  const sql = `
    SELECT project_path, timestamp, command, file_path
    FROM tool_calls
    WHERE host = 'local' AND tool_name IN ('Edit', 'Write') AND file_path IS NOT NULL
  `;
  return queryDuckdb(dbPath, sql, ToolCall);
}

async function gh(args: string[]): Promise<string> {
  const proc = Bun.spawn(["gh", ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`gh ${args.join(" ")} failed (${code}): ${err.trim()}`);
  return out;
}

const SearchItem = z.looseObject({
  repository: z.looseObject({ nameWithOwner: z.string(), isPrivate: z.boolean().optional() }),
  number: z.number(),
  title: z.string(),
  url: z.string(),
  createdAt: z.string(),
  body: z.string(),
});
type SearchItem = z.infer<typeof SearchItem>;

async function searchAuthored(kind: "prs" | "issues", created: string): Promise<SearchItem[]> {
  const out = await gh([
    "search",
    kind,
    "--author",
    "bendrucker",
    "--created",
    created,
    "--limit",
    "300",
    "--json",
    "repository,number,title,url,createdAt,body",
  ]);
  return decodeJson(z.array(SearchItem), out, `gh search ${kind} --created ${created}`);
}

const PrDetail = z.looseObject({
  state: z.string(),
  merged_at: z.string().nullable(),
  base: z.looseObject({ sha: z.string() }),
  head: z.looseObject({ sha: z.string() }),
});

const PrFile = z.looseObject({
  filename: z.string(),
  additions: z.number(),
  deletions: z.number(),
});

async function fetchPrDiff(
  repo: string,
  number: number,
): Promise<{ detail: z.infer<typeof PrDetail>; diff: DiffStats }> {
  const [detailOut, filesOut] = await Promise.all([
    gh(["api", `repos/${repo}/pulls/${number}`]),
    gh(["api", `repos/${repo}/pulls/${number}/files`, "--paginate"]),
  ]);
  const detail = decodeJson(PrDetail, detailOut, `gh api repos/${repo}/pulls/${number}`);
  const files = decodeJson(z.array(PrFile), filesOut, `gh api repos/${repo}/pulls/${number}/files`);
  const diff: DiffStats = {
    files: files.length,
    changedLines: files.reduce((sum, f) => sum + f.additions + f.deletions, 0),
    binaryFiles: files.filter((f) => isBinaryPath(f.filename)).length,
  };
  return { detail, diff };
}

const CommitSummary = z.looseObject({
  sha: z.string(),
  commit: z.looseObject({ message: z.string() }),
});

const CommitDetail = z.looseObject({
  sha: z.string(),
  html_url: z.string(),
  commit: z.looseObject({
    message: z.string(),
    author: z.looseObject({ date: z.string() }),
  }),
  parents: z.array(z.looseObject({ sha: z.string() })),
  files: z
    .array(
      z.looseObject({
        filename: z.string(),
        additions: z.number(),
        deletions: z.number(),
        patch: z.string().optional(),
      }),
    )
    .optional(),
});
type CommitDetail = z.infer<typeof CommitDetail>;

async function listAuthoredCommits(
  repo: string,
  path: string,
  since: string,
  until?: string,
): Promise<string[]> {
  const params = new URLSearchParams({ author: "bendrucker", path, since, per_page: "100" });
  if (until != null) params.set("until", until);
  const out = await gh(["api", `repos/${repo}/commits?${params.toString()}`]);
  const rows = decodeJson(
    z.array(CommitSummary),
    out,
    `gh api repos/${repo}/commits (path=${path})`,
  );
  return rows.map((r) => r.sha);
}

async function fetchCommit(repo: string, sha: string): Promise<CommitDetail> {
  const out = await gh(["api", `repos/${repo}/commits/${sha}`]);
  return decodeJson(CommitDetail, out, `gh api repos/${repo}/commits/${sha}`);
}

const DOC_REPOS = [
  "bendrucker/claude",
  "bendrucker/dotfiles",
  "bendrucker/infrastructure",
  "bendrucker/activity-hub",
  "bendrucker/honeycomb-cli",
  "bendrucker/tailgate",
  "bendrucker/terraform-credentials-keychain",
  "bendrucker/terraform-provider-pkcs12",
  "bendrucker/route-agent",
  "bendrucker/logbook",
  "bendrucker/code-hub",
  "bendrucker/bendrucker.me",
  "bendrucker/github-action-node-version",
  "bendrucker/myra",
  "bendrucker/claude-code-agents-md",
  "bendrucker/creditcards",
  "bendrucker/creditcards-types",
  "bendrucker/azure-blob-to-s3",
  "bendrucker/anthropic-text-editor-inspector",
  "bendrucker/convex-firebase",
  "bendrucker/packhorse",
  "bendrucker/node-ziptastic",
  "bendrucker/git-log-parser",
  "bendrucker/angularjs-stripe",
  "bendrucker/terraform-apply-timeout",
  "bendrucker/terraform-configuration-aliases-action",
];

const DOC_PATHS = ["README.md", "docs"];

const SKILL_REPOS = ["bendrucker/claude"];
const SKILL_PATHS = [
  "plugins",
  "user/CLAUDE.md",
  "CLAUDE.md",
  "user/rules",
  "user/agents",
  ".claude/rules",
];

// SKILL.md files under a test fixtures/ tree are synthetic.
function isSkillPath(filename: string): boolean {
  if (filename.includes("/fixtures/")) return false;
  return (
    filename.endsWith("SKILL.md") ||
    filename.endsWith("CLAUDE.md") ||
    (filename.includes("/rules/") && filename.endsWith(".md")) ||
    (filename.includes("/agents/") && filename.endsWith(".md"))
  );
}

interface RawCandidate {
  surface: Surface;
  repo: string;
  ref: string;
  createdAt: string;
  url: string;
  summary: string;
  diff: DiffStats;
  notes: string;
  body: string;
}

function finalizeIds<T>(items: T[], prefix: string): (T & { id: string })[] {
  const result: (T & { id: string })[] = [];
  for (const [i, item] of items.entries()) {
    result.push({ ...item, id: `${prefix}-${String(i + 1).padStart(3, "0")}` });
  }
  return result;
}

async function minePrs(
  dbPath: string,
  linkedPrs: Set<string>,
  targetCount: number,
): Promise<RawCandidate[]> {
  // Sequential: gh search shares a stricter secondary rate limit than the core API.
  const oldItems = await searchAuthored("prs", `<${PRE_CLAUDE_CODE.slice(0, 10)}`);
  const newItems = await searchAuthored("prs", `>=${POST_WINDOW.slice(0, 10)}`);
  const eligible = [...oldItems, ...newItems].filter((item) => {
    if (item.repository.isPrivate) return false;
    if (!isEligibleDate(item.createdAt)) return false;
    if (hasAiMarkers(item.body)) return false;
    if (proseLength(item.body) < 300) return false;
    if (
      isPostWindow(item.createdAt) &&
      linkedPrs.has(`${item.repository.nameWithOwner}#${item.number}`)
    ) {
      return false;
    }
    return true;
  });

  const fetched = await mapPool(eligible, GITHUB_CONCURRENCY, async (item) => ({
    item,
    ...(await fetchPrDiff(item.repository.nameWithOwner, item.number)),
  }));
  const candidates: RawCandidate[] = [];
  for (const { item, detail, diff } of fetched) {
    const repo = item.repository.nameWithOwner;
    if (!fitsDiffBudget(diff)) continue;
    candidates.push({
      surface: "pr",
      repo,
      ref: String(item.number),
      createdAt: item.createdAt,
      url: item.url,
      summary: item.title,
      diff,
      notes: `state=${detail.state}${detail.merged_at != null ? " merged" : ""}; base=${detail.base.sha.slice(0, 8)} head=${detail.head.sha.slice(0, 8)}`,
      body: item.body,
    });
  }
  return selectSample(candidates, targetCount * 2, 3);
}

async function mineIssues(
  dbPath: string,
  issueCreateCalls: ToolCallRow[],
  targetCount: number,
): Promise<RawCandidate[]> {
  // Sequential: gh search shares a stricter secondary rate limit than the core API.
  const oldItems = await searchAuthored("issues", `<${PRE_CLAUDE_CODE.slice(0, 10)}`);
  const newItems = await searchAuthored("issues", `>=${POST_WINDOW.slice(0, 10)}`);
  const eligible = [...oldItems, ...newItems].filter((item) => {
    if (item.repository.isPrivate) return false;
    if (!isEligibleDate(item.createdAt)) return false;
    if (hasAiMarkers(item.body)) return false;
    if (proseLength(item.body) < 300) return false;
    const repo = item.repository.nameWithOwner;
    if (
      isPostWindow(item.createdAt) &&
      hasMatchingCommand(issueCreateCalls, repo, item.createdAt, item.title)
    ) {
      return false;
    }
    return true;
  });

  const candidates: RawCandidate[] = eligible.map((item) => ({
    surface: "issue",
    repo: item.repository.nameWithOwner,
    ref: String(item.number),
    createdAt: item.createdAt,
    url: item.url,
    summary: item.title,
    diff: { files: 0, changedLines: 0, binaryFiles: 0 },
    notes:
      "context needed: the repo's README/architecture at issue time to reproduce the bug or feature described",
    body: item.body,
  }));
  return selectSample(candidates, targetCount * 2, 3);
}

async function mineDocCommits(
  gitCommitCalls: ToolCallRow[],
  fileTouches: ToolCallRow[],
  targetCount: number,
  repos: string[],
  paths: string[],
  filterFile: (filename: string) => boolean,
  minWords: number,
  surface: Surface,
  maxPerRepo: number,
): Promise<RawCandidate[]> {
  const listings = await mapPool(
    repos.flatMap((repo) => paths.map((path) => ({ repo, path }))),
    GITHUB_CONCURRENCY,
    async ({ repo, path }) => {
      const oldShas = await listAuthoredCommits(repo, path, EARLIEST_MINING_DATE, PRE_CLAUDE_CODE);
      const newShas = await listAuthoredCommits(repo, path, POST_WINDOW);
      return [...oldShas, ...newShas].map((sha) => ({ repo, sha }));
    },
  );
  const commits = new Map(listings.flat().map((c) => [`${c.repo}@${c.sha}`, c]));
  const fetched = await mapPool([...commits.values()], GITHUB_CONCURRENCY, async (c) => ({
    ...c,
    commit: await fetchCommit(c.repo, c.sha),
  }));

  const candidates: RawCandidate[] = [];
  for (const { repo, sha, commit } of fetched) {
    const when = commit.commit.author.date;
    if (!isEligibleDate(when)) continue;
    const subject = commit.commit.message.split("\n")[0] ?? "";
    if (hasAiMarkers(commit.commit.message)) continue;
    if (isPostWindow(when) && hasMatchingCommand(gitCommitCalls, repo, when, subject)) continue;

    const files = commit.files ?? [];
    const targetFiles = files.filter((f) => filterFile(f.filename));
    if (targetFiles.length === 0) continue;
    if (
      isPostWindow(when) &&
      targetFiles.some((f) => hasTouchedFile(fileTouches, repo, when, f.filename))
    ) {
      continue;
    }
    const wordsAdded = targetFiles.reduce((sum, f) => sum + countProseWordsAdded(f.patch ?? ""), 0);
    if (wordsAdded < minWords) continue;

    const diff: DiffStats = {
      files: files.length,
      changedLines: files.reduce((sum, f) => sum + f.additions + f.deletions, 0),
      binaryFiles: files.filter((f) => isBinaryPath(f.filename)).length,
    };
    if (!fitsDiffBudget(diff, { maxFiles: 10, maxLines: 600 })) continue;

    candidates.push({
      surface,
      repo,
      ref: sha.slice(0, 12),
      createdAt: when,
      url: commit.html_url,
      summary: subject,
      diff,
      notes: `${wordsAdded} words added to ${targetFiles.map((f) => f.filename).join(", ")}`,
      body: candidateBody(commit.commit.message, targetFiles, minWords),
    });
  }
  return selectSample(candidates, targetCount * 2, maxPerRepo);
}

function buildSplitSection(
  candidates: RawCandidate[],
  prefix: string,
  targetTotal: number,
  balanceCount = 0,
): SplitCandidate[] {
  const kept = candidates.slice(0, targetTotal);
  const split = assignSplit(kept);
  const withBalance = markBalance(split, balanceCount, (item) =>
    item.diff.changedLines > 0 ? item.diff.changedLines : item.body.length,
  );
  return finalizeIds(withBalance, prefix);
}

async function writeOriginals(dataDir: string, items: SplitCandidate[]): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await Promise.all(
    items.map((item) =>
      Bun.write(
        join(dataDir, `${item.id}.json`),
        `${JSON.stringify(
          {
            id: item.id,
            surface: item.surface,
            repo: item.repo,
            ref: item.ref,
            created_at: item.createdAt,
            url: item.url,
            split: item.split,
            balance: item.balance,
            diff: item.diff,
            body: item.body,
          },
          null,
          2,
        )}\n`,
      ),
    ),
  );
}

function resolveDbPath(db: string | undefined): string {
  if (db != null && db !== "") return db;
  const pluginData = process.env.CLAUDE_PLUGIN_DATA;
  const tmp = process.env.TMPDIR;
  const dataDir =
    pluginData != null && pluginData !== ""
      ? pluginData
      : join(tmp != null && tmp !== "" ? tmp : "/tmp", "claude-session");
  return join(dataDir, "session.duckdb");
}

interface MineFlags {
  db?: string | undefined;
  out: string;
  dataDir: string;
  prTarget: number;
  issueTarget: number;
  docTarget: number;
  skillTarget: number;
}

async function main(flags: MineFlags) {
  const dbPath = resolveDbPath(flags.db);
  if (!(await Bun.file(dbPath).exists())) {
    console.error(`No session index at ${dbPath}.`);
    console.error("Build it first: bun plugins/claude-code/skills/session/scripts/refresh.ts");
    process.exit(1);
  }

  console.log("Loading session-index exclusion sets (host=local)...");
  const [linkedPrs, issueCreateCalls, gitCommitCalls, fileTouches] = await Promise.all([
    queryLinkedPrKeys(dbPath),
    queryToolCalls(dbPath, "%gh issue create%"),
    queryToolCalls(dbPath, "%git commit%"),
    queryFileTouches(dbPath),
  ]);

  console.log("Mining PR bodies via gh search...");
  const prs = await minePrs(dbPath, linkedPrs, flags.prTarget);
  console.log(`  ${prs.length} PR candidates after filters`);

  console.log("Mining issues via gh search...");
  const issues = await mineIssues(dbPath, issueCreateCalls, flags.issueTarget);
  console.log(`  ${issues.length} issue candidates after filters`);

  console.log("Mining doc/README commits via gh api...");
  const docs = await mineDocCommits(
    gitCommitCalls,
    fileTouches,
    flags.docTarget,
    DOC_REPOS,
    DOC_PATHS,
    (filename: string) => filename === "README.md" || filename.startsWith("docs/"),
    150,
    "doc",
    1,
  );
  console.log(`  ${docs.length} doc candidates after filters`);

  console.log("Mining skill/CLAUDE.md commits via gh api...");
  const skills = await mineDocCommits(
    gitCommitCalls,
    fileTouches,
    flags.skillTarget,
    SKILL_REPOS,
    SKILL_PATHS,
    isSkillPath,
    80,
    "skill",
    3,
  );
  console.log(`  ${skills.length} skill candidates after filters`);

  const prSection = buildSplitSection(prs, "pr", flags.prTarget, 2);
  const issueSection = buildSplitSection(issues, "issue", flags.issueTarget);
  const docSection = buildSplitSection(docs, "doc", flags.docTarget);
  const skillSection = buildSplitSection(skills, "skill", flags.skillTarget);

  const gaps: string[] = [];
  if (skillSection.length < flags.skillTarget) {
    gaps.push(
      `Skills surface: only ${skillSection.length}/${flags.skillTarget} qualifying candidates found. ` +
        "Most of bendrucker/claude's SKILL.md and CLAUDE.md prose in the post-2026-06-30 window is written " +
        "through Claude Code sessions, which is exactly what the hand-written rule excludes.",
    );
  }
  if (docSection.length < flags.docTarget) {
    gaps.push(
      `Docs surface: only ${docSection.length}/${flags.docTarget} qualifying candidates found.`,
    );
  }
  gaps.push(
    "The post-window exclusion check matches on repo + time proximity, plus either a title/subject " +
      "substring in tool_calls.command (gh issue create / git commit) or an Edit/Write tool call " +
      "touching the same file (doc/skill commits only). It stays a heuristic: quoting or renames can " +
      "dodge the substring match, and a same-repo unrelated session within the time window can trigger " +
      "a false exclusion.",
  );
  gaps.push(
    "Pre-2025-02-24 items skip the session-link check entirely (the index has no rows before 2026-06-30), " +
      "which is correct per the rule but means those candidates rely on the date window alone.",
  );

  const bySurface = new Map<Surface, SplitCandidate[]>([
    ["pr", prSection],
    ["issue", issueSection],
    ["doc", docSection],
    ["skill", skillSection],
  ]);

  const all = [...prSection, ...issueSection, ...docSection, ...skillSection];
  await writeOriginals(flags.dataDir, all);

  const markdown = renderBriefsMarkdown(bySurface, gaps);
  await mkdir(dirname(flags.out), { recursive: true });
  await Bun.write(flags.out, markdown);

  console.log(`Wrote ${all.length} candidates to ${flags.dataDir}`);
  console.log(`Wrote brief list to ${flags.out}`);
}

function int(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new InvalidArgumentError("Not an integer.");
  return n;
}

export const program = new Command("mine")
  .description(
    "Mine candidate briefs (PR bodies, issues, docs, skills) Ben wrote by hand in public repos, for the authoring eval suite to replay.",
  )
  .option("--db <path>", "session.duckdb path (defaults to the session skill's data dir)")
  .option(
    "--out <path>",
    "Output path for the human-readable brief list",
    join(import.meta.dirname, "..", "..", "..", "..", "..", "tmp", "briefs.md"),
  )
  .option(
    "--data-dir <dir>",
    "Output directory for original deliverables",
    join(import.meta.dirname, "..", "data"),
  )
  .option("--pr-target <n>", "PR candidates to select", int, 15)
  .option("--issue-target <n>", "issue candidates to select", int, 9)
  .option("--doc-target <n>", "doc candidates to select", int, 8)
  .option("--skill-target <n>", "skill candidates to select", int, 4)
  .action(main);

if (import.meta.main) await program.parseAsync();
