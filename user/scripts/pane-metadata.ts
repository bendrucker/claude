#!/usr/bin/env bun
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { brandGlyph } from "./glyphs";

// herdr strips control bytes out of reported token values, so a pre-colored
// value cannot survive: the escape is dropped and its `[32m` residue renders as
// text. The dial's color therefore has to be the token's *name*, which herdr's
// sidebar config styles per name. One name carries the glyph at a time and the
// rest are cleared, so the four here mirror the four `dialColor` levels.
export const CONTEXT_TOKENS = ["ctx_low", "ctx_mid", "ctx_high", "ctx_crit"] as const;

export type ContextToken = (typeof CONTEXT_TOKENS)[number];

export interface DialReport {
  token: ContextToken;
  value: string;
}

const CachedReport = z.object({
  sig: z.string(),
  at: z.number(),
});
type CachedReport = z.infer<typeof CachedReport>;

// The size the transcript had when the title beside it was read. An unchanged
// size means nothing has been appended, so the next render needs no read at all.
const CachedTitle = z.object({
  size: z.number(),
  title: z.string().nullable(),
});
type CachedTitle = z.infer<typeof CachedTitle>;

// The name the herdr sidebar config binds to as `$title`.
const TITLE_TOKEN = "title";

// Claude Code rewrites the title record as a session goes, so the live title
// sits near the end of the transcript rather than wherever it was first named.
// Across 376 named transcripts the last record was within 53 KB of the end, so
// this window carries several times that and keeps the read a fixed cost a
// transcript running to megabytes cannot grow.
const TITLE_TAIL_BYTES = 262_144;

const SOURCE = "claude-statusline";
const TTL_MS = 86_400_000;
const REFRESH_MS = 3_600_000;
const HERDR_TIMEOUT_MS = 5_000;
const UNSAFE_NAME = /[^A-Za-z0-9._-]+/g;

function cacheFile(sessionId: string, suffix: string): string {
  return join(tmpdir(), "claude-pane-metadata", `${sessionId.replace(UNSAFE_NAME, "-")}${suffix}`);
}

export function cachePath(sessionId: string): string {
  return cacheFile(sessionId, ".json");
}

export function titleCachePath(sessionId: string): string {
  return cacheFile(sessionId, ".title.json");
}

export function shouldReport(cached: CachedReport | null, sig: string, now: number): boolean {
  if (!cached || cached.sig !== sig) return true;
  // A herdr restart drops every reported token, and an unconditional cache hit
  // would leave the sidebar blank until the dial next moves, which can be hours.
  return now - cached.at >= REFRESH_MS;
}

export function reportSignature(report: DialReport | null, title: string | null): string {
  return `${brandGlyph}:${report ? `${report.token}=${report.value}` : ""}:${title ?? ""}`;
}

// The brand mark rides along on the dial's call rather than getting one of its
// own, because it needs exactly what the dial already has: a report that repeats.
// herdr holds pane metadata in the server's memory, so every restart drops it,
// and the nightly `dotfiles-upgrade` restarts the server to install plugins.
// Reported once at SessionStart, the mark never comes back, and a session that
// was already open shows herdr's own robot for the rest of its life.
//
// The dial is optional so that riding along costs the mark nothing:
// `context_window` is absent until a turn has closed, and the pane should be
// branded before then.
//
// The title rides along the same way. A session that has not been named yet
// clears the token instead of leaving it, so a pane reused by a new session
// drops the last one's title rather than showing it as this session's.
export function reportArgs(
  paneId: string,
  report: DialReport | null,
  title: string | null,
): string[] {
  const args = [
    "pane",
    "report-metadata",
    paneId,
    "--source",
    SOURCE,
    "--ttl-ms",
    String(TTL_MS),
    "--display-agent",
    brandGlyph,
  ];
  if (title != null && title !== "") args.push("--token", `${TITLE_TOKEN}=${title}`);
  else args.push("--clear-token", TITLE_TOKEN);
  if (!report) return args;

  args.push("--token", `${report.token}=${report.value}`);
  for (const name of CONTEXT_TOKENS) {
    if (name !== report.token) args.push("--clear-token", name);
  }
  return args;
}

const TitleRecord = z.looseObject({
  type: z.string().optional().catch(undefined),
  aiTitle: z.string().optional().catch(undefined),
  customTitle: z.string().optional().catch(undefined),
});

// Claude Code names a session by appending a record to its transcript, and
// appends another on every rename, so the last such record is the live title.
// `/title` writes `custom-title` where the model's own naming writes `ai-title`.
function recordTitle(line: string): string | null {
  // Nearly every line is a turn, and a prompt quoting these names parses to some
  // other `type`. Testing the raw line first keeps the scan off `JSON.parse` for
  // all but a handful of lines in a transcript that runs to megabytes.
  if (!line.includes("-title")) return null;
  let record: z.infer<typeof TitleRecord>;
  try {
    record = TitleRecord.parse(JSON.parse(line));
  } catch {
    return null;
  }
  if (record.type === "ai-title") return record.aiTitle ?? null;
  if (record.type === "custom-title") return record.customTitle ?? null;
  return null;
}

// The last title a chunk of transcript names, or null when it names none. A
// chunk taken from mid-file opens on a partial line, which is dropped rather
// than parsed. A half-written record at the end fails to parse and is ignored.
export function latestTitle(chunk: string, partialFirstLine: boolean): string | null {
  const lines = chunk.split("\n");
  if (partialFirstLine) lines.shift();

  let title: string | null = null;
  for (const line of lines) {
    // herdr strips control bytes out of token values, which would glue the words
    // of a multi-line title together, so flatten whitespace here instead.
    const found = recordTitle(line)?.replaceAll(/\s+/gu, " ").trim();
    if (found != null && found !== "") title = found;
  }
  return title;
}

async function readCacheFile<T>(path: string, schema: z.ZodType<T>): Promise<T | null> {
  try {
    return schema.parse(await Bun.file(path).json());
  } catch {
    return null;
  }
}

// Caching is best effort. A render that cannot write costs the next one a
// rescan or a repeated report, so a failure here must not reach the value the
// caller went to the trouble of computing.
async function writeCacheFile(path: string, value: unknown): Promise<void> {
  try {
    await Bun.write(path, JSON.stringify(value));
  } catch {
    // Rendering the line takes priority over remembering what was rendered.
  }
}

// The session title Claude Code has settled on, or null before it names one.
// Read on every status line render, so an unchanged transcript costs a stat and
// a changed one a bounded read of the tail. The file is never read end to end.
export async function readSessionTitle(
  transcriptPath: string,
  sessionId: string,
): Promise<string | null> {
  const path = titleCachePath(sessionId);
  const cached = await readCacheFile(path, CachedTitle);
  try {
    const file = Bun.file(transcriptPath);
    const size = file.size;
    if (cached?.size === size) return cached.title;

    const start = Math.max(0, size - TITLE_TAIL_BYTES);
    // Standing by the cached title is what carries a name across a stretch of
    // transcript long enough to push every title record out of the window.
    const title =
      latestTitle(await file.slice(start, size).text(), start > 0) ?? cached?.title ?? null;
    await writeCacheFile(path, { size, title });
    return title;
  } catch {
    return cached?.title ?? null;
  }
}

// `agent_session.value` is the Claude session UUID herdr's integration hook
// reports, which makes the pane match exact where cwd or title would guess.
const PaneList = z.looseObject({
  result: z
    .looseObject({
      panes: z
        .array(
          z.looseObject({
            pane_id: z.string().optional().catch(undefined),
            agent_session: z
              .looseObject({ value: z.string().optional().catch(undefined) })
              .optional()
              .catch(undefined),
          }),
        )
        .optional()
        .catch(undefined),
    })
    .optional()
    .catch(undefined),
});

export function findPane(paneList: string, sessionId: string): string | null {
  let parsed: z.infer<typeof PaneList>;
  try {
    parsed = PaneList.parse(JSON.parse(paneList));
  } catch {
    return null;
  }
  const pane = parsed.result?.panes?.find((p) => p.agent_session?.value === sessionId);
  return pane?.pane_id ?? null;
}

// The dial and the title are each optional and the child reads them by
// position, so an absent one is passed as an empty placeholder rather than
// shifting the argument after it.
export function childArgs(
  sessionId: string,
  report: DialReport | null,
  title: string | null,
): string[] {
  return [sessionId, report?.token ?? "", report?.value ?? "", title ?? ""];
}

// Called on every status line render, so the steady state has to be a file read
// and nothing else. Only a changed report reaches herdr, and it reaches it
// through a detached child: the status line must render at the same speed
// whether herdr is fast, slow, or not running.
export async function reportPaneMetadata(
  sessionId: string,
  report: DialReport | null,
  transcriptPath: string | null,
): Promise<void> {
  const paneId = process.env.HERDR_PANE_ID;
  if (paneId == null || paneId === "") return;

  // The dedup cache and the transcript are unrelated files, so the render waits
  // on one round trip rather than two.
  const path = cachePath(sessionId);
  const [cached, title] = await Promise.all([
    readCacheFile(path, CachedReport),
    transcriptPath != null && transcriptPath !== ""
      ? readSessionTitle(transcriptPath, sessionId)
      : null,
  ]);

  const sig = reportSignature(report, title);
  if (!shouldReport(cached, sig, Date.now())) return;

  // The cache records the attempt rather than the outcome. A herdr that is down
  // would otherwise turn every later render back into a spawn.
  await writeCacheFile(path, { sig, at: Date.now() });

  Bun.spawn([process.execPath, import.meta.path, ...childArgs(sessionId, report, title)], {
    stdio: ["ignore", "ignore", "ignore"],
  }).unref();
}

function parseToken(value: string | undefined): ContextToken | null {
  return CONTEXT_TOKENS.find((token) => token === value) ?? null;
}

if (import.meta.main) {
  const [sessionId, token, value, title] = process.argv.slice(2);
  const name = parseToken(token);
  if (sessionId != null && sessionId !== "") {
    const list = Bun.spawnSync(["herdr", "pane", "list"], { timeout: HERDR_TIMEOUT_MS });
    const paneId = list.success ? findPane(list.stdout.toString(), sessionId) : null;
    if (paneId != null && paneId !== "") {
      const report = name != null && value != null && value !== "" ? { token: name, value } : null;
      Bun.spawnSync(["herdr", ...reportArgs(paneId, report, title ?? null)], {
        timeout: HERDR_TIMEOUT_MS,
      });
    }
  }
}
