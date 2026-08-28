import { extractComments, languageForPath } from "./extract";
import { isExemptComment } from "./exempt";
import type { Comment } from "./types";

/** Density totals over the added lines of one or more edits. Chars are non-whitespace. */
export interface AddedLineStats {
  addedLines: number;
  commentChars: number;
  codeChars: number;
  commentLines: number;
  codeLines: number;
  /** Lines carrying both comment and code chars. */
  mixedLines: number;
  commentWords: number;
  commentCount: number;
  maxCommentChars: number;
}

export function emptyStats(): AddedLineStats {
  return {
    addedLines: 0,
    commentChars: 0,
    codeChars: 0,
    commentLines: 0,
    codeLines: 0,
    mixedLines: 0,
    commentWords: 0,
    commentCount: 0,
    maxCommentChars: 0,
  };
}

function addInto(into: AddedLineStats, stats: AddedLineStats): void {
  into.addedLines += stats.addedLines;
  into.commentChars += stats.commentChars;
  into.codeChars += stats.codeChars;
  into.commentLines += stats.commentLines;
  into.codeLines += stats.codeLines;
  into.mixedLines += stats.mixedLines;
  into.commentWords += stats.commentWords;
  into.commentCount += stats.commentCount;
  into.maxCommentChars = Math.max(into.maxCommentChars, stats.maxCommentChars);
}

/**
 * Multiset line diff keyed on a line's non-whitespace content, so moved,
 * re-indented, and realigned lines don't count and each extra duplicate counts
 * once. Returns 1-based indices into the fragment's lines.
 */
export function addedLines(oldText: string, newText: string): { fragment: string; added: Set<number> } {
  const key = (line: string) => line.replace(/\s+/g, "");
  const oldCounts = new Map<string, number>();
  for (const line of oldText.split("\n")) {
    const k = key(line);
    oldCounts.set(k, (oldCounts.get(k) ?? 0) + 1);
  }
  const added = new Set<number>();
  const newLines = newText.split("\n");
  newLines.forEach((line, i) => {
    const k = key(line);
    const remaining = oldCounts.get(k) ?? 0;
    if (remaining > 0) {
      oldCounts.set(k, remaining - 1);
    } else {
      added.add(i + 1);
    }
  });
  return { fragment: newText, added };
}

function nonWsLen(s: string): number {
  return s.replace(/\s/g, "").length;
}

const DELIMITER = /^\s*(?:\/\/+|\/\*+|\*+\/?|--|#+|;+|"""|''')?\s*/;

function commentWords(text: string): number {
  return text
    .split("\n")
    .map((line) => line.replace(DELIMITER, "").replace(/\*+\/\s*$/, ""))
    .join(" ")
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

/**
 * Measure the added lines of one fragment, attributing each line's non-ws chars
 * to comment or code by the extracted comment intervals. Exempt (directive,
 * shebang, license) comments count as code. A fragment the grammar cannot parse
 * measures as all zeros.
 */
export async function measureAddedLines(
  fragment: string,
  added: Set<number>,
  language: string,
): Promise<AddedLineStats> {
  const stats = emptyStats();
  let comments: Comment[];
  try {
    comments = (await extractComments(fragment, language)).filter((c) => !isExemptComment(c));
  } catch {
    return stats;
  }
  const lines = fragment.split("\n");
  const intervals = new Map<number, Array<[number, number]>>();
  for (const c of comments) {
    for (let ln = c.startLine; ln <= c.endLine; ln++) {
      const text = lines[ln - 1] ?? "";
      // A coalesced run of line comments holds its column on every line, so
      // code to the left of an aligned trailing comment stays code.
      const start = ln === c.startLine || c.kind === "line" ? c.startColumn : 0;
      const end = ln === c.endLine ? c.endColumn : text.length;
      const list = intervals.get(ln) ?? [];
      list.push([start, end]);
      intervals.set(ln, list);
    }
  }
  const touched = new Set<Comment>();
  for (let ln = 1; ln <= lines.length; ln++) {
    if (!added.has(ln)) continue;
    const text = lines[ln - 1] ?? "";
    const total = nonWsLen(text);
    if (total === 0) continue;
    stats.addedLines++;
    let comment = 0;
    for (const [start, end] of intervals.get(ln) ?? []) {
      comment += nonWsLen(text.slice(start, end));
    }
    const code = Math.max(0, total - comment);
    stats.commentChars += comment;
    stats.codeChars += code;
    if (comment > 0 && code > 0) stats.mixedLines++;
    else if (comment > 0) stats.commentLines++;
    else stats.codeLines++;
    for (const c of comments) {
      if (ln >= c.startLine && ln <= c.endLine) touched.add(c);
    }
  }
  for (const c of touched) {
    stats.commentCount++;
    stats.commentWords += commentWords(c.text);
    stats.maxCommentChars = Math.max(stats.maxCommentChars, c.text.length);
  }
  return stats;
}

/** Calibrated per-language comment-share floors (median pre-change file share). */
export const BASELINES: Record<string, number> = {
  sql: 0.35,
  rust: 0.23,
  go: 0.22,
  toml: 0.14,
  cpp: 0.125,
  python: 0.07,
  ruby: 0.06,
  javascript: 0.05,
  yaml: 0.05,
  shellscript: 0.04,
  typescript: 0,
  vue: 0.03,
  tsx: 0,
};

export const DEFAULT_BASELINE = 0.1;

export function baselineFor(language: string): number {
  return BASELINES[language] ?? DEFAULT_BASELINE;
}

export interface DensityScore {
  /** Comment share of non-ws chars on added lines. */
  share: number;
  /** Prose words of introduced comments per added code line. */
  wordsPerCodeLine: number;
  /** Comment weight beyond what the language baseline predicts for this much code. */
  excessChars: number;
}

/** Weight floor per introduced comment: a short comment still costs a reader an interruption. */
export const MIN_COMMENT_CHARS = 90;

/** Comments a file must introduce before their average size scales the per-comment floor. */
export const TERSE_MIN_COMMENTS = 5;
/** Average comment size the floor targets; a run of shorter comments scales it up. */
export const TERSE_AVG_CHARS = 78;
/** Ceiling on the terse floor multiplier. */
export const TERSE_MAX_FACTOR = 2.25;

/** Floor on one file's comment weight, charged per comment rather than per char. */
export function commentWeightFloor(stats: AddedLineStats): number {
  const flat = MIN_COMMENT_CHARS * stats.commentCount;
  if (stats.commentCount < TERSE_MIN_COMMENTS) return flat;
  const average = stats.commentChars / stats.commentCount;
  return flat * Math.min(TERSE_MAX_FACTOR, Math.max(1, TERSE_AVG_CHARS / Math.max(1, average)));
}

/** Share at or above which added lines are a documentation edit, never escalated. */
export const DOCS_PASS_SHARE = 0.95;

export function densityScore(stats: AddedLineStats, language: string): DensityScore {
  const chars = stats.commentChars + stats.codeChars;
  const b = baselineFor(language);
  const expected = (b / (1 - b)) * stats.codeChars;
  const weighted = Math.max(stats.commentChars, commentWeightFloor(stats));
  const share = chars === 0 ? 0 : stats.commentChars / chars;
  return {
    share,
    wordsPerCodeLine: stats.commentWords / Math.max(1, stats.codeLines),
    excessChars: share >= DOCS_PASS_SHARE ? 0 : Math.max(0, weighted - expected),
  };
}

export type Tier = "docs-pass" | "none" | "report" | "strong";

/** A file must carry this many non-ws chars before the per-file tier clauses apply. */
export const FILE_MIN_CHARS = 300;
/** A file must introduce this many distinct comments before it alone can report. */
export const FILE_MIN_COMMENTS = 3;
/** Below this many added lines a unit carries too little signal to tier. */
export const MIN_ADDED_LINES = 30;
/** Total excess chars at or above this escalates to strong. */
export const STRONG_EXCESS_CHARS = 2800;
/** No report below this much surplus comment prose. */
export const REPORT_MIN_EXCESS_CHARS = 750;
/** Session share at or above this reports. */
export const REPORT_SESSION_SHARE = 0.25;
/** Session words-per-code-line at or above this reports. */
export const REPORT_WORDS_PER_CODE_LINE = 2.0;
/** A single qualifying file at or above this share reports. */
export const REPORT_FILE_SHARE = 0.5;
/** How many of the highest-excess files the rollup names. */
export const WORST_FILES = 5;

export interface ScoredFile {
  path: string;
  language: string;
  stats: AddedLineStats;
}

export interface SessionScore {
  stats: AddedLineStats;
  share: number;
  wordsPerCodeLine: number;
  /** Sum of per-file excess chars, each against its own language baseline. */
  excessChars: number;
  tier: Tier;
  worstFiles: Array<ScoredFile & { share: number; excessChars: number }>;
}

/** Machine-written files: their comments are generator output, not authorship. */
const GENERATED_PATH =
  /(\.gen\.|\.pb\.|_pb2\.|[._]generated\.|\.d\.ts$|(^|\/)(gen|generated)\.[a-z]+$|(^|\/)generated\/)/;

export function isGeneratedPath(path: string): boolean {
  return GENERATED_PATH.test(path);
}

export function sessionScore(input: ScoredFile[]): SessionScore {
  const files = input.filter((file) => !isGeneratedPath(file.path));
  const stats = emptyStats();
  const scored = files.map((file) => {
    addInto(stats, file.stats);
    const { share, excessChars } = densityScore(file.stats, file.language);
    return { ...file, share, excessChars };
  });
  const chars = stats.commentChars + stats.codeChars;
  const share = chars === 0 ? 0 : stats.commentChars / chars;
  const wordsPerCodeLine = stats.commentWords / Math.max(1, stats.codeLines);
  const excessChars = scored.reduce((sum, file) => sum + file.excessChars, 0);
  const heavyFile = scored.some(
    (file) =>
      file.stats.commentChars + file.stats.codeChars >= FILE_MIN_CHARS &&
      file.stats.commentCount >= FILE_MIN_COMMENTS &&
      file.share >= REPORT_FILE_SHARE,
  );
  const reports =
    excessChars >= REPORT_MIN_EXCESS_CHARS &&
    (share >= REPORT_SESSION_SHARE ||
      wordsPerCodeLine >= REPORT_WORDS_PER_CODE_LINE ||
      heavyFile);
  const tier: Tier =
    stats.addedLines < MIN_ADDED_LINES
      ? "none"
      : share >= DOCS_PASS_SHARE
        ? "docs-pass"
        : excessChars >= STRONG_EXCESS_CHARS
          ? "strong"
          : reports
            ? "report"
            : "none";
  const worstFiles = scored
    .filter((file) => file.excessChars > 0)
    .sort((a, b) => b.excessChars - a.excessChars)
    .slice(0, WORST_FILES);
  return { stats, share, wordsPerCodeLine, excessChars, tier, worstFiles };
}

/**
 * Per-path rank weights for `rankCommentsWeighted`: 1 plus each file's excess
 * comment chars as a share of its total chars, so a file at baseline weighs 1
 * and weights stay bounded below 2.
 */
export function densityWeights(files: ScoredFile[]): Map<string, number> {
  return new Map(
    files.map((file) => {
      const chars = file.stats.commentChars + file.stats.codeChars;
      const { excessChars } = densityScore(file.stats, file.language);
      return [file.path, chars === 0 ? 1 : 1 + excessChars / chars];
    }),
  );
}

interface EditInput {
  file_path?: string;
  old_string?: string;
  new_string?: string;
  content?: string;
  edits?: Array<{ old_string?: string; new_string?: string }>;
}

/** Path segments marking scratch output the score ignores. */
const SKIP_PATHS = ["/scratchpad/", "/tmp/", "/tasks/"];

const MAX_FRAGMENT_CHARS = 500_000;

/**
 * Score every Edit/Write/MultiEdit in a session JSONL transcript, accumulating
 * added-line stats per file across edits. A Write counts its full content as
 * new. Files without a known language and scratch paths are skipped.
 */
export async function scoreTranscript(
  transcriptPath: string,
): Promise<{ files: ScoredFile[]; session: SessionScore }> {
  const content = await Bun.file(transcriptPath).text();
  const perFile = new Map<string, ScoredFile>();
  for (const line of content.split("\n")) {
    if (!line.includes('"tool_use"')) continue;
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const message = record.message as { content?: Array<Record<string, unknown>> } | undefined;
    if (!Array.isArray(message?.content)) continue;
    for (const block of message.content) {
      if (block.type !== "tool_use") continue;
      const name = block.name as string;
      if (name !== "Edit" && name !== "Write" && name !== "MultiEdit") continue;
      const input = block.input as EditInput;
      const path = input.file_path;
      if (!path) continue;
      if (SKIP_PATHS.some((part) => path.includes(part))) continue;
      const language = languageForPath(path);
      if (language == null) continue;
      const pairs: Array<{ old: string; new: string }> =
        name === "Write"
          ? [{ old: "", new: input.content ?? "" }]
          : name === "MultiEdit"
            ? (input.edits ?? []).map((e) => ({ old: e.old_string ?? "", new: e.new_string ?? "" }))
            : [{ old: input.old_string ?? "", new: input.new_string ?? "" }];
      for (const pair of pairs) {
        if (pair.new.length === 0 || pair.new.length > MAX_FRAGMENT_CHARS) continue;
        const { fragment, added } = addedLines(pair.old, pair.new);
        if (added.size === 0) continue;
        const entry = perFile.get(path) ?? { path, language, stats: emptyStats() };
        perFile.set(path, entry);
        addInto(entry.stats, await measureAddedLines(fragment, added, language));
      }
    }
  }
  const files = [...perFile.values()];
  return { files, session: sessionScore(files) };
}
