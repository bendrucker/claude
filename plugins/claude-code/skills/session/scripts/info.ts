#!/usr/bin/env tsx

import type { Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

async function findSessionFile(sessionId: string): Promise<string | null> {
  const projectsDir = path.join(os.homedir(), ".claude", "projects");

  let entries: Dirent[];
  try {
    entries = await fs.readdir(projectsDir, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const dir of entries) {
    if (!dir.isDirectory()) continue;
    const candidate = path.join(projectsDir, dir.name, `${sessionId}.jsonl`);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  return null;
}

interface SessionInfo {
  sessionId: string;
  filePath: string;
  startTime: string | null;
  gitBranch: string | null;
  cwd: string | null;
  typeCounts: Map<string, number>;
  toolCounts: Map<string, number>;
  summary: string | null;
}

async function extractSessionInfo(sessionId: string, filePath: string): Promise<SessionInfo> {
  const content = await fs.readFile(filePath, "utf-8");
  const lines = content.split("\n").filter((line) => line.trim());

  let startTime: string | null = null;
  let gitBranch: string | null = null;
  let cwd: string | null = null;
  let summary: string | null = null;
  const typeCounts = new Map<string, number>();
  const toolCounts = new Map<string, number>();

  for (const line of lines) {
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    const type = record.type as string | undefined;
    if (type) {
      typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
    }

    if (!startTime && typeof record.timestamp === "string") {
      startTime = record.timestamp;
    }
    if (!gitBranch && typeof record.gitBranch === "string") {
      gitBranch = record.gitBranch;
    }
    if (!cwd && typeof record.cwd === "string") {
      cwd = record.cwd;
    }

    if (type === "summary" && typeof record.summary === "string") {
      summary = record.summary;
    }

    if (type === "assistant") {
      const message = record.message as Record<string, unknown> | undefined;
      const contentArray = Array.isArray(message?.content) ? message.content : [];
      for (const raw of contentArray) {
        const block = raw as Record<string, unknown>;
        if (block?.type === "tool_use") {
          const name = block.name as string;
          toolCounts.set(name, (toolCounts.get(name) ?? 0) + 1);
        }
      }
    }
  }

  return { sessionId, filePath, startTime, gitBranch, cwd, typeCounts, toolCounts, summary };
}

function formatCountMap(counts: Map<string, number>, limit: number): string {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => `  ${String(count).padStart(4)} ${name}`)
    .join("\n");
}

function formatSessionInfo(info: SessionInfo): string {
  const lines: string[] = [];

  lines.push(`Session: ${info.sessionId}`);
  lines.push(`File: ${info.filePath}`);
  lines.push("");

  if (info.startTime) lines.push(`Started: ${info.startTime}`);
  if (info.gitBranch) lines.push(`Branch: ${info.gitBranch}`);
  if (info.cwd) lines.push(`Directory: ${info.cwd}`);

  lines.push("");
  lines.push("Message counts:");
  lines.push(formatCountMap(info.typeCounts, 10));

  lines.push("");
  lines.push("Tool usage:");
  lines.push(formatCountMap(info.toolCounts, 15));

  if (info.summary) {
    lines.push("");
    lines.push("Latest summary:");
    lines.push(info.summary);
  }

  return lines.join("\n");
}

async function main(): Promise<void> {
  const sessionId = process.argv[2];
  if (!sessionId) {
    console.error("Usage: info.ts <session-id>");
    process.exit(1);
  }

  const filePath = await findSessionFile(sessionId);
  if (!filePath) {
    console.error(`Session file not found for ID: ${sessionId}`);
    process.exit(1);
  }

  const info = await extractSessionInfo(sessionId, filePath);
  console.log(formatSessionInfo(info));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
