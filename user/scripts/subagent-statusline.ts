#!/usr/bin/env bun
import { homedir } from "node:os";
import { join } from "node:path";
import { styleText } from "node:util";
import { purposeGlyphs, remoteGlyph } from "./glyphs";

interface Task {
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

function statusIcon(status: string): string {
  switch (status) {
    case "completed":
      return styleText("green", "✓");
    case "failed":
      return styleText("red", "✗");
    default:
      return styleText("yellow", "▶");
  }
}

// The agent kind drives the purpose glyph; untyped kinds (general-purpose,
// unknown) get none.
function purposeGlyph(agentType: string | null): string {
  const glyph =
    agentType && agentType in purposeGlyphs
      ? purposeGlyphs[agentType as keyof typeof purposeGlyphs]
      : null;
  return glyph ? styleText(["dim"], glyph) : "";
}

// .type is the agent origin. Cloud always marks remote agents; local agents
// carry no origin marker.
function remoteMarker(type: string | undefined): string {
  return type === "remote_agent" ? styleText(["dim"], remoteGlyph) : "";
}

// The purpose glyph leads, the cloud marker follows, so origin stays visible
// without displacing the kind.
export function renderTask(
  task: Task,
  columns: number | null,
  now: number,
  agentType: string | null,
): { id: string; content: string } {
  const icon = statusIcon(task.status ?? "running");
  const glyph = purposeGlyph(agentType);
  const marker = remoteMarker(task.type);

  let meta = "";
  if (task.startTime != null) meta += `· ${formatElapsed(task.startTime, now)} `;
  if ((task.tokenCount ?? 0) > 0) meta += `· ${formatTokens(task.tokenCount ?? 0)}`;

  const build = (text: string): string => {
    let body = icon;
    if (glyph) body += ` ${glyph}`;
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
        text = `${[...text].slice(0, textMax).join("")}…`;
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
