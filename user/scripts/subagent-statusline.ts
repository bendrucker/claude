#!/usr/bin/env bun
import { homedir } from "node:os";
import { join } from "node:path";
import { styleText } from "node:util";
import { genericGlyph, purposeGlyphs, remoteGlyph } from "./glyphs";

export interface Task {
  id: string;
  description?: string;
  type?: string;
  name?: string;
  status?: string;
  startTime?: number;
  tokenCount?: number;
}

interface SubagentInput {
  columns?: number;
  tasks?: Task[];
}

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
  const glyph = (agentType ? purposeGlyphs.get(agentType) : undefined) ?? genericGlyph;
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
  if (agentType) {
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
): { id: string; content: string } {
  const icon = typeIcon(agentType, task.status ?? "running");
  const marker = remoteMarker(task.type);

  const metaParts: string[] = [];
  if (task.startTime != null) metaParts.push(formatElapsed(task.startTime, now));
  if ((task.tokenCount ?? 0) > 0) metaParts.push(formatTokens(task.tokenCount ?? 0));

  // The type name trails as dim text after the meta. The icon already conveys
  // the kind, so a narrow terminal can drop the name without losing it.
  const build = (text: string, withType: boolean): string => {
    let body = icon;
    if (marker) body += ` ${marker}`;
    body += `  ${text}`;
    const trailing = [...metaParts];
    if (withType && agentType) trailing.push(agentType);
    if (trailing.length) {
      body += ` ${styleText(["dim"], trailing.map((part) => `· ${part}`).join(" "))}`;
    }
    return body;
  };

  let text = task.description
    ? formatDescription(task.description, agentType)
    : task.name || "agent";
  let content = build(text, true);

  if (columns != null && Bun.stringWidth(content) > columns) {
    // Shed the optional type name first; the icon keeps the kind visible.
    if (agentType) content = build(text, false);
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

// Each task id keys a sidecar the harness writes next to the subagent
// transcript, scoped to the current project's sessions (derived from cwd). A
// miss yields no glyph (the prune signal if the harness changes this layout).
async function agentTypeFor(id: string, projectDir: string): Promise<string | null> {
  try {
    for (const rel of new Bun.Glob(`*/subagents/agent-${id}.meta.json`).scanSync({
      cwd: projectDir,
    })) {
      const meta = (await Bun.file(join(projectDir, rel)).json()) as { agentType?: string };
      return meta.agentType ?? null;
    }
  } catch {
    // Sidecar missing or unreadable: skip the purpose glyph.
  }
  return null;
}

if (import.meta.main) {
  // Empty or malformed stdin renders nothing rather than crashing, matching the
  // bash original's tolerance of bad input.
  const raw = await Bun.stdin.text();
  let input: SubagentInput | null = null;
  try {
    if (raw.trim()) input = JSON.parse(raw) as SubagentInput;
  } catch {
    input = null;
  }
  if (!input) process.exit(0);

  const slug = process.cwd().replace(/[/.]/g, "-");
  const projectDir = join(homedir(), ".claude", "projects", slug);
  const now = Date.now();

  const lines: string[] = [];
  for (const task of input.tasks ?? []) {
    const agentType = await agentTypeFor(task.id, projectDir);
    lines.push(JSON.stringify(renderTask(task, input.columns ?? null, now, agentType)));
  }
  if (lines.length) process.stdout.write(`${lines.join("\n")}\n`);
}
