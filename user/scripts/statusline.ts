#!/usr/bin/env bun
import { mkdirSync } from "node:fs";
import { basename, dirname } from "node:path";
import { z } from "zod";
import { decodeJson } from "../../packages/decode/index";
import { effortMarker } from "./effort";
import { dialGlyph } from "./glyphs";
import { modelMarker } from "./model";
import { type ContextToken, type DialReport, reportPaneMetadata } from "./pane-metadata";
import { expandTilde, RateLimits } from "./rate-limits";
import { styleText } from "./style";

const num = z.number().optional().catch(undefined);
const str = z.string().optional().catch(undefined);

const CurrentUsage = z.looseObject({
  input_tokens: num,
  output_tokens: num,
  cache_creation_input_tokens: num,
  cache_read_input_tokens: num,
});

const StatusInput = z.looseObject({
  session_id: str,
  transcript_path: str,
  model: z.looseObject({ id: str, display_name: str }).nullish().catch(undefined),
  effort: z.looseObject({ level: str }).nullish().catch(undefined),
  context_window: z
    .looseObject({
      used_percentage: z.number().nullish().catch(undefined),
      current_usage: CurrentUsage.nullish().catch(undefined),
    })
    .optional()
    .catch(undefined),
  cost: z
    .looseObject({ total_lines_added: num, total_lines_removed: num })
    .optional()
    .catch(undefined),
  rate_limits: RateLimits.nullish().catch(undefined),
});
type StatusInput = z.infer<typeof StatusInput>;

// A styled, ordered piece of the worktree label. `text` is the visible content
// that elision shortens; `pre`/`suf` are escape wrappers (color, OSC 8 link)
// kept intact around whatever text survives.
export interface Span {
  text: string;
  pre: string;
  suf: string;
}

export interface WorktreeData {
  branch: string;
  path: string;
  isMain: boolean;
  ciUrl: string | null;
  repoUrl: string | null;
  ahead: number;
}

type DialColor = "green" | "yellow" | "redBright" | "red";

const SEP = " ";

// OSC 8 hyperlink open/close. Emitted unconditionally: the status line's stdout
// is piped while still rendered, so TTY-gated link helpers would drop the link.
function osc8Open(url: string): string {
  return `\x1b]8;;${url}\x1b\\`;
}
const OSC8_CLOSE = "\x1b]8;;\x1b\\";

// styleText wraps a whole string; spans need the open/close codes separately so
// each surviving piece of elided text keeps its color. Split them off a sentinel.
function styleFragments(style: Parameters<typeof styleText>[0]): { open: string; close: string } {
  const [open, close] = styleText(style, "\0").split("\0");
  return { open: open ?? "", close: close ?? "" };
}

const DIM = styleFragments(["dim"]);
const CYAN = styleFragments("cyan");

export function dialColor(pct: number, exceeds: boolean): DialColor {
  let color: DialColor;
  if (pct < 40) color = "green";
  else if (pct < 65) color = "yellow";
  else if (pct < 80) color = "redBright";
  else color = "red";

  if (exceeds) {
    if (color === "green") color = "yellow";
    else if (color === "yellow" && pct >= 45) color = "red";
  }
  return color;
}

export function dialIndex(pct: number): number {
  const idx = Math.floor((pct * 7) / 100);
  return Math.min(7, idx);
}

// Claude Code's top-level `exceeds_200k_tokens` reflects the most recent API
// response and is not recomputed on compaction, so it stays true after the
// context shrinks. Derive it from the live `current_usage` instead, the same
// source as `used_percentage`, so the dial's color and position reset together.
export function exceeds200k(input: StatusInput): boolean {
  const usage = input.context_window?.current_usage;
  if (!usage) return false;
  const total =
    (usage.input_tokens ?? 0) +
    (usage.output_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0);
  return total > 200_000;
}

// Session-config markers (model, effort) render dim at their default and switch
// to this accent when off-default, so a non-standard session reads at a glance.
const ACCENT: Parameters<typeof styleText>[0] = ["magenta", "bold"];

function configMarker(text: string, isDefault: boolean): string {
  return styleText(isDefault ? ["dim"] : ACCENT, text);
}

// A leading letter for the active model so Fable-vs-Opus reads at a glance.
// Always shown: absence would be ambiguous once more than one model is in play.
export function modelSegment(input: StatusInput): string | null {
  const marker = modelMarker(input.model?.id, input.model?.display_name);
  return marker ? configMarker(marker.letter, marker.isDefault) : null;
}

// A baseline dot-ramp for the reasoning effort, styled like the model letter so
// the two session-config markers read alike. Absent when the model has no effort.
export function effortSegment(input: StatusInput): string | null {
  const marker = effortMarker(input.effort?.level);
  return marker ? configMarker(marker.glyph, marker.isDefault) : null;
}

function dialState(input: StatusInput): { color: DialColor; glyph: string } | null {
  const pct = input.context_window?.used_percentage;
  if (pct == null) return null;

  const intPct = Math.round(pct);
  return { color: dialColor(intPct, exceeds200k(input)), glyph: dialGlyph(dialIndex(intPct)) };
}

export function dialSegment(input: StatusInput): string | null {
  const dial = dialState(input);
  return dial ? styleText(dial.color, dial.glyph) : null;
}

const DIAL_TOKENS: Record<DialColor, ContextToken> = {
  green: "ctx_low",
  yellow: "ctx_mid",
  redBright: "ctx_high",
  red: "ctx_crit",
};

// The same dial herdr's sidebar shows, named by color rather than styled: see
// `pane-metadata.ts` for why the color rides on the token name.
export function contextDial(input: StatusInput): DialReport | null {
  const dial = dialState(input);
  return dial ? { token: DIAL_TOKENS[dial.color], value: dial.glyph } : null;
}

export function linesSegment(input: StatusInput): string | null {
  const added = input.cost?.total_lines_added ?? 0;
  const removed = input.cost?.total_lines_removed ?? 0;
  if (added === 0 && removed === 0) return null;

  const parts: string[] = [];
  if (added > 0) parts.push(styleText("green", `+${added}`));
  if (removed > 0) parts.push(styleText("red", `-${removed}`));
  return parts.join(" ");
}

// Middle-elide ordered spans to a visible-width budget, preserving the start of
// the first span and the end of the last with a single `…` between. Operates on
// codepoint arrays so multi-byte branch names elide on character boundaries.
export function elideSpans(spans: Span[], budget: number): string {
  // oxlint-disable-next-line typescript/no-misused-spread -- eliding on code points is the documented intent; grapheme clusters would change the width budget.
  const chars = spans.map((s) => [...s.text]);
  const total = chars.reduce((sum, c) => sum + c.length, 0);

  if (total <= budget) {
    return spans.map((s) => `${s.pre}${s.text}${s.suf}`).join("");
  }

  const keep = Math.max(1, budget - 1);
  const head = Math.floor((keep + 1) / 2);
  const tail = keep - head;
  const tailStart = total - tail;

  let pos = 0;
  let out = "";
  let ellipsisDone = false;
  for (const [i, span] of spans.entries()) {
    const c = chars[i] ?? [];
    const spanStart = pos;
    const spanEnd = pos + c.length;
    let piece = "";

    if (spanStart < head) {
      const hEnd = Math.min(head, spanEnd);
      piece += c.slice(0, hEnd - spanStart).join("");
    }

    if (spanEnd > tailStart) {
      const tBegin = Math.max(tailStart, spanStart);
      if (!ellipsisDone) {
        piece += "…";
        ellipsisDone = true;
      }
      piece += c.slice(tBegin - spanStart, spanEnd - spanStart).join("");
    }

    if (piece !== "") out += `${span.pre}${piece}${span.suf}`;
    pos = spanEnd;
  }

  if (!ellipsisDone) out += "…";
  return out;
}

// Collapse the repo≈branch redundancy: when the repo name is a prefix or suffix
// of the sanitized branch, the branch already carries the repo. Worktrunk names
// branches worktree-<id> against a <id> worktree, so the repo is a suffix.
function showRepo(repo: string, sanitizedBranch: string): boolean {
  if (repo === "") return true;
  return !(sanitizedBranch.startsWith(repo) || sanitizedBranch.endsWith(repo));
}

export function formatWorktree(data: WorktreeData, budget: number): string[] {
  const sanitizedBranch = data.branch.replaceAll(/[/\\]/g, "-");
  let repo = basename(data.path);
  const repoSuffix = `.${sanitizedBranch}`;
  if (repo.endsWith(repoSuffix)) repo = repo.slice(0, -repoSuffix.length);

  const repoPre = data.repoUrl != null && data.repoUrl !== "" ? osc8Open(data.repoUrl) : "";
  const repoSuf = data.repoUrl != null && data.repoUrl !== "" ? OSC8_CLOSE : "";

  const spans: Span[] = [];
  if (data.isMain) {
    spans.push({ text: repo, pre: repoPre, suf: repoSuf });
  } else {
    if (showRepo(repo, sanitizedBranch)) {
      spans.push({ text: repo, pre: repoPre, suf: repoSuf });
      spans.push({ text: "/", pre: DIM.open, suf: DIM.close });
    }
    const branchPre =
      data.ciUrl != null && data.ciUrl !== "" ? CYAN.open + osc8Open(data.ciUrl) : CYAN.open;
    const branchSuf =
      data.ciUrl != null && data.ciUrl !== "" ? OSC8_CLOSE + CYAN.close : CYAN.close;
    spans.push({ text: data.branch, pre: branchPre, suf: branchSuf });
  }

  const aheadSeg = data.ahead > 0 ? styleText(["dim"], `↑${data.ahead}`) : "";

  // Reserve room for the ahead segment (and its separator) before eliding.
  const labelBudget = aheadSeg !== "" ? budget - Bun.stringWidth(aheadSeg) - SEP.length : budget;

  const segments: string[] = [];
  if (labelBudget < 3) {
    if (aheadSeg !== "") segments.push(aheadSeg);
    return segments;
  }

  segments.push(elideSpans(spans, labelBudget));
  if (aheadSeg !== "") segments.push(aheadSeg);
  return segments;
}

// Mirror the live `rate_limits` to a file so external readers (the menu-bar app)
// can show usage without wrapping the status line command. Claude Code only pipes
// rate limits through the status line, so this is the single place they surface.
export async function emitRateLimits(input: StatusInput, target: string): Promise<void> {
  const limits = input.rate_limits;
  if (!limits) return;

  const path = expandTilde(target);
  mkdirSync(dirname(path), { recursive: true });
  await Bun.write(path, `${JSON.stringify(limits)}\n`);
}

export function buildStatusLine(
  input: StatusInput,
  columns: number,
  worktree: WorktreeData | null,
): string {
  const segments: string[] = [];

  const model = modelSegment(input);
  if (model != null && model !== "") segments.push(model);
  const effort = effortSegment(input);
  if (effort != null && effort !== "") segments.push(effort);
  const dial = dialSegment(input);
  if (dial != null && dial !== "") segments.push(dial);
  const lines = linesSegment(input);
  if (lines != null && lines !== "") segments.push(lines);

  // Fixed segments (dials) are measured first and never elided; the worktree
  // label takes whatever width remains so the dial stays visible at any width.
  let fixedWidth = 0;
  for (const [i, s] of segments.entries()) {
    if (i > 0) fixedWidth += SEP.length;
    fixedWidth += Bun.stringWidth(s);
  }

  const worktreeBudget = columns - fixedWidth - SEP.length - 1;
  if (worktree) segments.push(...formatWorktree(worktree, worktreeBudget));

  return segments.join(SEP);
}

const WorktreeList = z.array(
  z.looseObject({
    is_current: z.boolean().optional().catch(undefined),
    is_main: z.boolean().optional().catch(undefined),
    branch: str,
    path: str,
    ci: z.looseObject({ url: str }).optional().catch(undefined),
    remote: z.looseObject({ name: str }).optional().catch(undefined),
    main: z.looseObject({ ahead: num }).optional().catch(undefined),
  }),
);

function resolveWorktree(): WorktreeData | null {
  try {
    const wt = Bun.spawnSync(["wt", "list", "statusline", "--format=json"]);
    if (!wt.success) return null;

    const list = decodeJson(WorktreeList, wt.stdout.toString(), "wt list statusline");
    const cur = list.find((w) => w.is_current);
    if (!cur) return null;

    const ciUrl = cur.ci?.url ?? null;
    let repoUrl: string | null = null;
    if (ciUrl != null && ciUrl !== "") {
      const git = Bun.spawnSync(["git", "remote", "get-url", cur.remote?.name ?? "origin"]);
      const raw = git.success ? git.stdout.toString().trim() : "";
      if (raw !== "") repoUrl = raw.replace(/^git@([^:]*):/, "https://$1/").replace(/\.git$/, "");
    }

    return {
      branch: cur.branch ?? "",
      path: cur.path ?? "",
      isMain: cur.is_main === true,
      ciUrl,
      repoUrl,
      ahead: cur.main?.ahead ?? 0,
    };
  } catch {
    return null;
  }
}

if (import.meta.main) {
  // Empty or malformed stdin renders nothing rather than crashing to a blank
  // line, matching the bash original's tolerance of bad input.
  const raw = await Bun.stdin.text();
  let input: StatusInput | undefined;
  try {
    if (raw.trim() !== "") input = StatusInput.parse(JSON.parse(raw));
  } catch {
    input = undefined;
  }
  if (input) {
    const rateLimitsPath = process.env.CLAUDE_STATUSLINE_RATE_LIMITS_PATH;
    if (rateLimitsPath != null && rateLimitsPath !== "") {
      try {
        await emitRateLimits(input, rateLimitsPath);
      } catch {
        // Emitting usage is best-effort; rendering the line takes priority.
      }
    }

    const parsed = Number(process.env.COLUMNS);
    const columns = Number.isInteger(parsed) && parsed > 0 ? parsed : 80;
    process.stdout.write(buildStatusLine(input, columns, resolveWorktree()));

    // Not gated on the dial: the same report carries the brand mark and the
    // session title, which have to keep being sent even on the renders before
    // `context_window` shows up.
    if (input.session_id != null && input.session_id !== "") {
      try {
        await reportPaneMetadata(
          input.session_id,
          contextDial(input),
          input.transcript_path ?? null,
        );
      } catch {
        // The sidebar mirror is best-effort, and the line is already written.
      }
    }
  }
}
