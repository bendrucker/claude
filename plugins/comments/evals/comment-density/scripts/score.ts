#!/usr/bin/env bun

import { cli } from "cleye";
import { $ } from "bun";
import { join } from "node:path";
import { z } from "zod";
import { decodeFile } from "../../../../../packages/decode/index";
import { parseUnifiedDiff } from "../../../detection/diff";
import { languageForPath } from "../../../detection/extract";
import {
  addedLines,
  addInto,
  measureAddedLines,
  sessionScore,
  emptyStats,
  MIN_ADDED_LINES,
  type ScoredFile,
  type SessionScore,
} from "../../../detection/density";
import type { LineRange } from "../../../detection/types";

const root = join(import.meta.dirname, "..");

export interface CommitLabelRef {
  repo: string;
  sha: string;
}

export interface CommitScoreRow {
  repo: string;
  sha: string;
  measurable: boolean;
  score: SessionScore | null;
}

export interface SessionScoreRow {
  id: string;
  measurable: boolean;
  rows: number;
  score: SessionScore | null;
}

export interface ScoresFile {
  generatedAt: string;
  commits: CommitScoreRow[];
  sessions: Record<string, SessionScoreRow>;
}

const SKIP_PATHS = ["/scratchpad/", "/tmp/", "/tasks/"];
const VENDOR = /(^|\/)(vendor|node_modules|dist|build)\//;
const MAX_FILE_CHARS = 2_000_000;

function addedSet(ranges: LineRange[]): Set<number> {
  const added = new Set<number>();
  for (const range of ranges) {
    for (let ln = range.start; ln <= range.end; ln++) added.add(ln);
  }
  return added;
}

async function gitShow(repo: string, sha: string, path: string): Promise<string | null> {
  const result = await $`git -C ${repo} show ${sha}:${path}`.quiet().nothrow();
  return result.exitCode === 0 ? result.text() : null;
}

/** Re-measure a commit's added lines from its local repo through the live scorer. */
export async function scoreCommit(repo: string, sha: string): Promise<SessionScore | null> {
  const diff = await $`git -C ${repo} diff-tree -p --no-commit-id --no-renames -r ${sha}`
    .quiet()
    .nothrow();
  if (diff.exitCode !== 0) {
    console.error(`scoreCommit: git diff-tree failed for ${repo}@${sha}, excluding the commit`);
    return null;
  }
  const diffText = diff.text();
  if (diffText.trim() === "") return null;
  const files: ScoredFile[] = [];
  for (const file of parseUnifiedDiff(diffText)) {
    const language = languageForPath(file.path);
    if (language == null) continue;
    if (VENDOR.test(file.path)) continue;
    if (SKIP_PATHS.some((part) => file.path.includes(part))) continue;
    // oxlint-disable-next-line no-await-in-loop -- serialized git subprocesses against one repo. Fanning out thrashes the object store for no wall-clock win.
    const content = await gitShow(repo, sha, file.path);
    if (content == null || content.length > MAX_FILE_CHARS) continue;
    const added = addedSet(file.added);
    // Drop lines the diff calls added whose content the parent already carried,
    // so a reindent or realignment introduces no comments.
    // oxlint-disable-next-line no-await-in-loop -- same serialized git access as above.
    const parent = await gitShow(repo, `${sha}^`, file.path);
    if (parent != null) {
      const reshaped = addedLines(parent, content).added;
      for (const line of added) if (!reshaped.has(line)) added.delete(line);
    }
    if (added.size === 0) continue;
    // oxlint-disable-next-line no-await-in-loop -- Shiki extraction is CPU-bound, so parallelizing buys nothing.
    const stats = await measureAddedLines(content, added, language);
    files.push({ path: file.path, language, stats });
  }
  return sessionScore(files);
}

const StatsFields = {
  addedLines: z.number(),
  commentChars: z.number(),
  codeChars: z.number(),
  commentLines: z.number(),
  codeLines: z.number(),
  mixedLines: z.number(),
  commentWords: z.number(),
  commentCount: z.number(),
  maxCommentChars: z.number(),
};

const StoredSessionRow = z.object({
  session: z.string(),
  edits: z.number(),
  files: z.array(z.object({ path: z.string(), ...StatsFields })),
});

type StoredSessionRow = z.output<typeof StoredSessionRow>;

const SESSION_ID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/;

/**
 * Group stored measurement rows by session id extracted from the transcript
 * path. A session's rows span its main transcript plus subagent transcripts.
 */
export async function loadStoredRows(dataPath: string): Promise<Map<string, StoredSessionRow[]>> {
  const bySession = new Map<string, StoredSessionRow[]>();
  const content = await Bun.file(dataPath).text();
  let malformed = 0;
  for (const line of content.split("\n")) {
    if (line.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      malformed++;
      continue;
    }
    const decoded = StoredSessionRow.safeParse(parsed);
    if (!decoded.success) {
      malformed++;
      continue;
    }
    const row = decoded.data;
    const id = row.session.match(SESSION_ID)?.[1];
    if (id == null) continue;
    const rows = bySession.get(id) ?? [];
    rows.push(row);
    bySession.set(id, rows);
  }
  if (malformed > 0) {
    console.error(`loadStoredRows: skipped ${malformed} malformed line(s) in ${dataPath}`);
  }
  return bySession;
}

/** Score one session from its stored rows, merging per-file stats across transcripts. */
export function scoreStoredSession(rows: StoredSessionRow[]): SessionScore {
  const perFile = new Map<string, ScoredFile>();
  for (const row of rows) {
    for (const file of row.files) {
      if (SKIP_PATHS.some((part) => file.path.includes(part))) continue;
      const language = languageForPath(file.path) ?? "unknown";
      const entry = perFile.get(file.path) ?? { path: file.path, language, stats: emptyStats() };
      perFile.set(file.path, entry);
      const { path: _path, ...stats } = file;
      addInto(entry.stats, stats);
    }
  }
  return sessionScore([...perFile.values()]);
}

async function main(): Promise<void> {
  const argv = cli({
    name: "score",
    help: {
      description: "Score every labeled commit and session with the current density scorer.",
    },
    flags: {
      out: {
        type: String,
        description: "Output path for the scores JSON",
        default: join(root, "results", "scores.json"),
      },
      stdout: {
        type: Boolean,
        description: "Print the scores JSON to stdout instead of writing --out",
        default: false,
      },
      sessions: {
        type: String,
        description: "Stored session measurement rows (JSONL)",
        default: join(root, "data", "sessions", "all-sessions.jsonl"),
      },
    },
  });

  const commitLabels = await decodeFile(
    z.array(z.object({ repo: z.string(), sha: z.string() }).loose()),
    join(root, "labels", "commits.json"),
  );
  const sessionLabels = await decodeFile(
    z.array(z.object({ id: z.string() }).loose()),
    join(root, "labels", "sessions.json"),
  );
  const complaintIds = await decodeFile(
    z.array(z.string()),
    join(root, "labels", "complaints.json"),
  );

  const commits: CommitScoreRow[] = [];
  for (const { repo, sha } of commitLabels) {
    // oxlint-disable-next-line no-await-in-loop -- commits score sequentially: each spawns its own git subprocess chain against local repos.
    const exists = await $`git -C ${repo} cat-file -e ${sha}^{commit}`.quiet().nothrow();
    if (exists.exitCode !== 0) {
      console.error(`warning: repo or sha not present locally, skipping ${repo} ${sha}`);
      commits.push({ repo, sha, measurable: false, score: null });
      continue;
    }
    // oxlint-disable-next-line no-await-in-loop -- same sequential scoring as above.
    const score = await scoreCommit(repo, sha);
    const measurable = score != null && score.stats.addedLines >= MIN_ADDED_LINES;
    commits.push({ repo, sha, measurable, score });
  }

  const stored = await loadStoredRows(argv.flags.sessions);
  const sessions: Record<string, SessionScoreRow> = {};
  const ids = new Set([...sessionLabels.map((s) => s.id), ...complaintIds]);
  for (const id of ids) {
    const rows = stored.get(id);
    if (!rows) {
      console.error(`warning: no stored rows for session ${id}`);
      sessions[id] = { id, measurable: false, rows: 0, score: null };
      continue;
    }
    const score = scoreStoredSession(rows);
    sessions[id] = {
      id,
      measurable: score.stats.addedLines >= MIN_ADDED_LINES,
      rows: rows.length,
      score,
    };
  }

  const scores: ScoresFile = { generatedAt: new Date().toISOString(), commits, sessions };
  const json = JSON.stringify(scores, null, 2);
  if (argv.flags.stdout) {
    console.log(json);
  } else {
    await Bun.write(argv.flags.out, `${json}\n`);
    const measurable = commits.filter((c) => c.measurable).length;
    const measurableSessions = Object.values(sessions).filter((s) => s.measurable).length;
    console.error(
      `scored ${measurable}/${commits.length} commits, ${measurableSessions}/${ids.size} sessions -> ${argv.flags.out}`,
    );
  }
}

if (import.meta.main) {
  await main();
}
