#!/usr/bin/env bun
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { effortGlyph } from "./effort";
import { genericGlyph, purposeGlyphs, remoteGlyph } from "./glyphs";
import { modelMarker } from "./model";
import { styleText } from "./style";

const str = z.string().optional().catch(undefined);
const num = z.number().optional().catch(undefined);

export const Task = z.looseObject({
  id: z.string(),
  description: str,
  type: str,
  name: str,
  status: str,
  startTime: num,
  tokenCount: num,
  model: str,
  effort: z.union([z.string(), z.number()]).optional().catch(undefined),
});
export type Task = z.infer<typeof Task>;

const SubagentInput = z.looseObject({
  columns: num,
  transcript_path: str,
  tasks: z.array(Task).optional().catch(undefined),
});

export function formatElapsed(startMs: number, nowMs: number): string {
  const elapsedS = Math.floor((nowMs - startMs) / 1000);
  return `${Math.floor(elapsedS / 60)}m ${elapsedS % 60}s`;
}

export function formatTokens(count: number): string {
  return count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count);
}

// Slice to a display-width budget, stopping before any character that would
// exceed it. Width-aware so multi-cell glyphs (CJK, emoji) never overflow.
function sliceToWidth(s: string, maxWidth: number): string {
  let width = 0;
  let out = "";
  for (const ch of s) {
    const w = Bun.stringWidth(ch);
    if (width + w > maxWidth) break;
    width += w;
    out += ch;
  }
  return out;
}

// Status drives the icon color: gray while running, green on success, red on
// failure. Folding status into the type glyph drops the separate status column.
function statusColor(status: string): "gray" | "green" | "red" {
  switch (status) {
    case "completed":
      return "green";
    case "failed":
      return "red";
    default:
      return "gray";
  }
}

// The agent kind drives the glyph; untyped kinds (general-purpose, unknown)
// fall back to the generic robot. Color carries the run status. The in-progress
// gray dims to recede behind the title; finished green/red stay vivid so a
// terminal state reads at a glance.
function typeIcon(agentType: string | null, status: string): string {
  const glyph =
    (agentType != null && agentType !== "" ? purposeGlyphs.get(agentType) : undefined) ??
    genericGlyph;
  const color = statusColor(status);
  return styleText(color === "gray" ? [color, "dim"] : color, glyph);
}

// .type is the agent origin. Cloud always marks remote agents; local agents
// carry no origin marker.
function remoteMarker(type: string | undefined): string {
  return type === "remote_agent" ? styleText(["dim"], remoteGlyph) : "";
}

// Descriptions arrive prefixed with the agent type (e.g. "Plan: design the
// API"), which the trailing dim type name already conveys. Drop the redundant
// prefix and sentence-case what remains so the title reads cleanly.
export function formatDescription(description: string, agentType: string | null): string {
  let text = description;
  if (agentType != null && agentType !== "") {
    const prefix = `${agentType}: `;
    if (text.toLowerCase().startsWith(prefix.toLowerCase())) text = text.slice(prefix.length);
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// The status-colored type glyph leads, the cloud marker follows, so origin
// stays visible without displacing the kind.
export function renderTask(
  task: Task,
  columns: number | null,
  now: number,
  agentType: string | null,
  activity: string | null = null,
  description: string | null = null,
  model: string | null = null,
): { id: string; content: string } {
  const icon = typeIcon(agentType, task.status ?? "running");
  const marker = remoteMarker(task.type);

  const metaParts: string[] = [];
  if (task.startTime != null) metaParts.push(formatElapsed(task.startTime, now));
  if ((task.tokenCount ?? 0) > 0) metaParts.push(formatTokens(task.tokenCount ?? 0));
  if (model != null && model !== "") metaParts.push(model);
  // Every declared level renders. The payload carries no session effort to
  // compare a task's against, and a task's effort is its agent config's
  // declaration rather than a resolved level, so there is no baseline to hide.
  const effort = effortGlyph(task.effort);
  if (effort != null && effort !== "") metaParts.push(effort);

  // The type name trails as dim text after the meta. The icon already conveys
  // the kind, so a narrow terminal can drop the name without losing it.
  const build = (text: string, withType: boolean): string => {
    let body = icon;
    if (marker !== "") body += ` ${marker}`;
    body += ` ${text}`;
    const trailing = [...metaParts];
    if (withType && agentType != null && agentType !== "") trailing.push(agentType);
    if (trailing.length !== 0) {
      body += ` ${styleText(["dim"], trailing.map((part) => `· ${part}`).join(" "))}`;
    }
    return body;
  };

  // Live activity from the transcript wins: it answers "what is it doing now"
  // where the static spawn prompt only repeats "You are implementing …" across
  // every teammate. The clean meta description (or stdin description) covers the
  // gap before the teammate's first action; the name is the last resort.
  const fallback = description ?? task.description ?? null;
  let text =
    activity != null && activity !== ""
      ? activity
      : fallback != null && fallback !== ""
        ? formatDescription(fallback, agentType)
        : task.name != null && task.name !== ""
          ? task.name
          : "agent";
  let content = build(text, true);

  if (columns != null && Bun.stringWidth(content) > columns) {
    // Shed the optional type name first; the icon keeps the kind visible.
    if (agentType != null && agentType !== "") content = build(text, false);
    const visible = Bun.stringWidth(content);
    if (visible > columns) {
      const overflow = visible - columns;
      const textMax = Bun.stringWidth(text) - overflow - 1;
      if (textMax > 0) {
        text = `${sliceToWidth(text, textMax)}…`;
        content = build(text, false);
      }
    }
  }

  return { id: task.id, content };
}

const AgentMeta = z.looseObject({ agentType: str, description: str });
type AgentMeta = z.infer<typeof AgentMeta>;

export const ContentBlock = z.looseObject({
  type: str,
  name: str,
  input: z.record(z.string(), z.unknown()).optional().catch(undefined),
  text: str,
});
export type ContentBlock = z.infer<typeof ContentBlock>;

const TranscriptEntry = z.looseObject({
  message: z
    .looseObject({
      role: str,
      content: z.array(ContentBlock).optional().catch(undefined),
      model: str,
    })
    .optional()
    .catch(undefined),
});
type TranscriptEntry = z.infer<typeof TranscriptEntry>;

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const basename = (p: unknown): string => text(p).split("/").pop() ?? "";
const firstWord = (cmd: unknown): string => text(cmd).trim().split(/\s+/)[0] ?? "";
const oneLine = (s: string): string => s.replace(/\s+/g, " ").trim();
const firstText = (...values: unknown[]): string => values.map(text).find((s) => s !== "") ?? "";

// A tool call renders as a verb plus its most telling argument: the file for
// file tools, the leading command word for Bash (ssh, grep, sed), the message
// summary for a teammate handoff. The harness truncates to the column budget,
// so these stay short and let the kind read at a glance.
export function humanizeTool(name: string, input: Record<string, unknown> = {}): string {
  switch (name) {
    case "Read":
      return `Reading ${basename(input.file_path)}`;
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return `Editing ${basename(input.file_path)}`;
    case "Write":
      return `Writing ${basename(input.file_path)}`;
    case "Bash":
      return `Running ${firstWord(input.command)}`;
    case "Grep":
    case "WebSearch":
      return oneLine(`Searching ${firstText(input.pattern, input.query)}`);
    case "Glob":
      return oneLine(`Globbing ${text(input.pattern)}`);
    case "ToolSearch":
      return "Searching tools";
    case "WebFetch":
      return `Fetching ${basename(input.url)}`;
    case "SendMessage":
      return `→ ${firstText(input.summary, "message")}`;
    case "Task":
    case "Agent":
      return `Spawning ${firstText(input.description, "agent")}`;
    case "TodoWrite":
      return "Updating todos";
    case "Skill":
      return oneLine(`Running /${firstText(input.skill, input.command)}`);
    default:
      return name !== "" ? name : "working";
  }
}

// The newest tool call or assistant line, whichever is later. A finished
// teammate's last entry is a text summary; a working one's last assistant entry
// ends in the tool it is mid-call on (the trailing tool_result is a separate
// user entry). Scanning content blocks back-to-front returns whichever the
// teammate did last. Thinking and tool results are not events here.
export function extractActivity(entries: TranscriptEntry[]): string | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const msg = entries[i]?.message;
    if (msg?.role !== "assistant" || !Array.isArray(msg.content)) continue;
    for (let j = msg.content.length - 1; j >= 0; j--) {
      const block = msg.content[j];
      if (block?.type === "tool_use" && typeof block.name === "string") {
        return humanizeTool(block.name, block.input ?? {});
      }
      if (block?.type === "text" && typeof block.text === "string" && block.text.trim() !== "") {
        return oneLine(block.text);
      }
    }
  }
  return null;
}

// The newest assistant model in a transcript tail.
export function extractModel(entries: TranscriptEntry[]): string | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const model = entries[i]?.message?.model;
    if (typeof model === "string" && model !== "") return model;
  }
  return null;
}

// A subagent's model letter, shown only when it differs from the session it was
// spawned from. Same model (or either unknown) yields no letter, keeping the
// line quiet unless a cheaper model is actually in play.
export function subagentModelLetter(
  subModel: string | null,
  sessionModel: string | null,
): string | null {
  if (subModel == null || subModel === "" || sessionModel == null || sessionModel === "")
    return null;
  const sub = modelMarker(subModel)?.letter ?? null;
  if (sub == null || sub === "" || sub === (modelMarker(sessionModel)?.letter ?? null)) return null;
  return sub;
}

// Each task id keys a sidecar pair the harness writes next to the subagent
// transcript, scoped to the current project's sessions (derived from cwd). The
// path prefix locates both the `.meta.json` and the `.jsonl`. A miss yields no
// glyph or activity (the prune signal if the harness changes this layout).
function subagentBase(id: string, projectDir: string): string | null {
  try {
    for (const rel of new Bun.Glob(`*/subagents/agent-${id}.meta.json`).scanSync({
      cwd: projectDir,
    })) {
      return join(projectDir, rel).slice(0, -".meta.json".length);
    }
  } catch {
    // Project directory unreadable: skip enrichment.
  }
  return null;
}

async function readMeta(base: string): Promise<AgentMeta | null> {
  try {
    return AgentMeta.parse(await Bun.file(`${base}.meta.json`).json());
  } catch {
    return null;
  }
}

// Transcripts grow to megabytes. Only the tail holds the latest events, so read
// a bounded suffix and drop the first line, which a mid-file slice splits.
const TAIL_BYTES = 65_536;
async function readEntries(path: string): Promise<TranscriptEntry[]> {
  try {
    const file = Bun.file(path);
    const size = file.size;
    if (size === 0) return [];
    const start = Math.max(0, size - TAIL_BYTES);
    const lines = (await file.slice(start).text()).split("\n");
    if (start > 0) lines.shift();
    const entries: TranscriptEntry[] = [];
    for (const line of lines) {
      if (line.trim() === "") continue;
      try {
        entries.push(TranscriptEntry.parse(JSON.parse(line)));
      } catch {
        // Skip malformed lines.
      }
    }
    return entries;
  } catch {
    return [];
  }
}

if (import.meta.main) {
  // Empty or malformed stdin renders nothing rather than crashing, matching the
  // bash original's tolerance of bad input.
  const raw = await Bun.stdin.text();
  let input: z.infer<typeof SubagentInput> | null = null;
  try {
    if (raw.trim() !== "") input = SubagentInput.parse(JSON.parse(raw));
  } catch {
    input = null;
  }
  if (!input) process.exit(0);

  const slug = process.cwd().replace(/[/.]/g, "-");
  const projectDir = join(homedir(), ".claude", "projects", slug);
  const now = Date.now();

  // All tasks share the parent session named by stdin, so the model every
  // subagent letter is compared against is read once.
  const sessionModel =
    input.transcript_path != null && input.transcript_path !== ""
      ? extractModel(await readEntries(input.transcript_path))
      : null;

  const lines = await Promise.all(
    (input.tasks ?? []).map(async (task) => {
      const base = subagentBase(task.id, projectDir);
      const hasBase = base != null && base !== "";
      const [meta, entries] = await Promise.all([
        hasBase ? readMeta(base) : null,
        hasBase ? readEntries(`${base}.jsonl`) : [],
      ]);
      const activity = extractActivity(entries);
      // The payload's model is resolved at spawn and covers a subagent that has
      // yet to write a turn. Task types that carry none fall back to the
      // transcript read alongside the activity.
      const model = subagentModelLetter(task.model ?? extractModel(entries), sessionModel);
      return JSON.stringify(
        renderTask(
          task,
          input.columns ?? null,
          now,
          meta?.agentType ?? null,
          activity,
          meta?.description ?? null,
          model,
        ),
      );
    }),
  );
  if (lines.length !== 0) process.stdout.write(`${lines.join("\n")}\n`);
}
