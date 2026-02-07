import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { collectConcurrent } from "./concurrent";
import { log, tracer } from "./debug";
import { isWithinDateRange, streamSessionFiles } from "./files";
import type { SearchOptions } from "./types";

export interface ToolStats {
  readonly name: string;
  readonly uses: number;
  readonly errors: number;
  readonly errorRate: number;
}

export interface UsageStats {
  readonly tools: ToolStats[];
  readonly totalSessions: number;
  readonly totalToolUses: number;
  readonly totalErrors: number;
}

interface SessionData {
  startTime: Date | null;
  tools: Map<string, { uses: number; errors: number }>;
}

async function collectSessionData(filePath: string): Promise<SessionData> {
  const data: SessionData = {
    startTime: null,
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

export async function getStats(options: SearchOptions = {}): Promise<UsageStats> {
  const toolsMap = new Map<string, { uses: number; errors: number }>();
  let totalSessions = 0;

  const span = tracer().startSpan("file_parsing");
  const sessions = await collectConcurrent(streamSessionFiles(options), async (file) => {
    log(`Processing ${file.path}`);
    return collectSessionData(file.path);
  });
  span.end();

  for (const session of sessions) {
    if (!isWithinDateRange(session.startTime, options)) continue;

    totalSessions++;

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

  return {
    tools,
    totalSessions,
    totalToolUses: tools.reduce((sum, t) => sum + t.uses, 0),
    totalErrors: tools.reduce((sum, t) => sum + t.errors, 0),
  };
}
