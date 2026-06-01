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
// fall back to the generic robot. Its color carries the run status.
function typeIcon(agentType: string | null, status: string): string {
  const glyph = (agentType ? purposeGlyphs.get(agentType) : undefined) ?? genericGlyph;
  return styleText(statusColor(status), glyph);
}

// .type is the agent origin. Cloud always marks remote agents; local agents
// carry no origin marker.
function remoteMarker(type: string | undefined): string {
  return type === "remote_agent" ? styleText(["dim"], remoteGlyph) : "";
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

  let meta = "";
  if (task.startTime != null) meta += `· ${formatElapsed(task.startTime, now)} `;
  if ((task.tokenCount ?? 0) > 0) meta += `· ${formatTokens(task.tokenCount ?? 0)}`;

  const build = (text: string): string => {
    let body = icon;
    if (marker) body += ` ${marker}`;
    body += ` ${text}`;
    if (meta) body += ` ${styleText(["dim"], meta)}`;
    return body;
  };

  let text = task.description || task.name || "agent";
  let content = build(text);

  if (columns != null) {
    const visible = Bun.stringWidth(content);
    if (visible > columns) {
      const overflow = visible - columns;
      const textMax = Bun.stringWidth(text) - overflow - 1;
      if (textMax > 0) {
        text = `${sliceToWidth(text, textMax)}…`;
        content = build(text);
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
