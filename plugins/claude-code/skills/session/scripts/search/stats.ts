import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { isWithinDateRange, streamSessionFiles } from "./files";
import type { SearchOptions } from "./types";

export interface ToolStats {
  readonly name: string;
  readonly uses: number;
  readonly errors: number;
  readonly errorRate: number;
}

export interface SessionSummary {
  readonly sessionId: string;
  readonly filePath: string;
  readonly projectPath: string | null;
  readonly errorCount: number;
  readonly toolUseCount: number;
  readonly startTime: Date | null;
}

export interface UsageStats {
  readonly tools: ToolStats[];
  readonly sessionsWithMostErrors: SessionSummary[];
  readonly totalSessions: number;
  readonly totalToolUses: number;
  readonly totalErrors: number;
}

interface SessionData {
  sessionId: string;
  filePath: string;
  projectPath: string | null;
  startTime: Date | null;
  tools: Map<string, { uses: number; errors: number }>;
  totalErrors: number;
  totalToolUses: number;
}

async function collectSessionData(filePath: string): Promise<SessionData> {
  const sessionId = filePath.split("/").pop()?.replace(".jsonl", "") ?? "";
  const data: SessionData = {
    sessionId,
    filePath,
    projectPath: null,
    startTime: null,
    tools: new Map(),
    totalErrors: 0,
    totalToolUses: 0,
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

    if (record.timestamp && !data.startTime) {
      data.startTime = new Date(record.timestamp as string);
    }

    if (record.type === "assistant") {
      const message = record.message as Record<string, unknown> | undefined;
      if (message?.content && Array.isArray(message.content)) {
        for (const item of message.content) {
          if (item && typeof item === "object" && item.type === "tool_use") {
            const toolName = item.name as string;
            const toolId = item.id as string;

            toolUseIds.set(toolId, toolName);
            data.totalToolUses++;

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
            data.totalErrors++;
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

export async function getStats(options: SearchOptions = {}): Promise<UsageStats> {
  const toolsMap = new Map<string, { uses: number; errors: number }>();
  const sessions: SessionData[] = [];

  const filePromises: Promise<SessionData>[] = [];

  for await (const filePath of streamSessionFiles(options)) {
    filePromises.push(collectSessionData(filePath));
  }

  const allSessions = await Promise.all(filePromises);

  for (const session of allSessions) {
    if (!isWithinDateRange(session.startTime, options)) continue;

    sessions.push(session);

    for (const [toolName, toolData] of session.tools) {
      const existing = toolsMap.get(toolName) || { uses: 0, errors: 0 };
      existing.uses += toolData.uses;
      existing.errors += toolData.errors;
      toolsMap.set(toolName, existing);
    }
  }

  const tools: ToolStats[] = [...toolsMap.entries()]
    .map(([name, data]) => ({
      name,
      uses: data.uses,
      errors: data.errors,
      errorRate: data.uses > 0 ? data.errors / data.uses : 0,
    }))
    .sort((a, b) => b.uses - a.uses);

  const sessionsWithMostErrors = sessions
    .filter((s) => s.totalErrors > 0)
    .sort((a, b) => b.totalErrors - a.totalErrors)
    .slice(0, 10)
    .map((s) => ({
      sessionId: s.sessionId,
      filePath: s.filePath,
      projectPath: s.projectPath,
      errorCount: s.totalErrors,
      toolUseCount: s.totalToolUses,
      startTime: s.startTime,
    }));

  return {
    tools,
    sessionsWithMostErrors,
    totalSessions: sessions.length,
    totalToolUses: sessions.reduce((sum, s) => sum + s.totalToolUses, 0),
    totalErrors: sessions.reduce((sum, s) => sum + s.totalErrors, 0),
  };
}
