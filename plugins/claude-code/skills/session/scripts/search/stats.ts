import { createReadStream } from "node:fs";
import * as path from "node:path";
import { createInterface } from "node:readline";
import { isWithinDateRange, streamSessionFiles } from "./files";
import type { SearchOptions } from "./types";

export interface SessionStats {
  readonly tools: Map<string, { uses: number; errors: number }>;
  readonly projects: Map<string, { sessions: number; totalMinutes: number }>;
  readonly totalSessions: number;
}

interface SessionData {
  projectPath: string | null;
  startTime: Date | null;
  endTime: Date | null;
  tools: Map<string, { uses: number; errors: number }>;
}

async function collectSessionData(filePath: string): Promise<SessionData> {
  const data: SessionData = {
    projectPath: null,
    startTime: null,
    endTime: null,
    tools: new Map(),
  };

  const toolUseIds = new Map<string, string>();

  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf-8" }),
    crlfDelay: Number.POSITIVE_INFINITY,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;

    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (record.cwd && !data.projectPath) {
      data.projectPath = record.cwd as string;
    }

    if (record.timestamp) {
      const ts = new Date(record.timestamp as string);
      if (!data.startTime || ts < data.startTime) data.startTime = ts;
      if (!data.endTime || ts > data.endTime) data.endTime = ts;
    }

    if (record.type === "assistant") {
      const message = record.message as Record<string, unknown> | undefined;
      if (message?.content && Array.isArray(message.content)) {
        for (const item of message.content) {
          if (item && typeof item === "object" && item.type === "tool_use") {
            const toolName = item.name as string;
            const toolId = item.id as string;

            toolUseIds.set(toolId, toolName);

            const existing = data.tools.get(toolName) || { uses: 0, errors: 0 };
            existing.uses++;
            data.tools.set(toolName, existing);
          }
        }
      }
    }

    if (record.type === "user" && !record.isMeta) {
      const message = record.message as Record<string, unknown> | undefined;
      if (message?.content && Array.isArray(message.content)) {
        for (const item of message.content) {
          if (item && typeof item === "object" && item.type === "tool_result" && item.is_error) {
            const toolUseId = item.tool_use_id as string;
            const toolName = toolUseIds.get(toolUseId);
            if (toolName) {
              const existing = data.tools.get(toolName);
              if (existing) {
                existing.errors++;
              }
            }
          }
        }
      }
    }
  }

  return data;
}

export async function getStats(options: SearchOptions = {}): Promise<SessionStats> {
  const stats: SessionStats = {
    tools: new Map(),
    projects: new Map(),
    totalSessions: 0,
  };

  const filePromises: Promise<SessionData>[] = [];

  for await (const filePath of streamSessionFiles(options)) {
    filePromises.push(collectSessionData(filePath));
  }

  const sessions = await Promise.all(filePromises);

  for (const session of sessions) {
    if (!isWithinDateRange(session.startTime, options)) continue;

    stats.totalSessions++;

    for (const [toolName, toolData] of session.tools) {
      const existing = stats.tools.get(toolName) || { uses: 0, errors: 0 };
      existing.uses += toolData.uses;
      existing.errors += toolData.errors;
      stats.tools.set(toolName, existing);
    }

    if (session.projectPath) {
      const existing = stats.projects.get(session.projectPath) || {
        sessions: 0,
        totalMinutes: 0,
      };
      existing.sessions++;
      if (session.startTime && session.endTime) {
        existing.totalMinutes += (session.endTime.getTime() - session.startTime.getTime()) / 60000;
      }
      stats.projects.set(session.projectPath, existing);
    }
  }

  return stats;
}
