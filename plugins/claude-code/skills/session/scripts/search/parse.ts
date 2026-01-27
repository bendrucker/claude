import { createReadStream } from "node:fs";
import * as path from "node:path";
import { createInterface } from "node:readline";
import type { Conversation, HookEvent, Message, ThinkingBlock, ToolResult, ToolUse } from "./types";

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === "string") return c;
        if (c && typeof c === "object") {
          if ("text" in c && typeof c.text === "string") return c.text;
          if ("thinking" in c && typeof c.thinking === "string") return c.thinking;
        }
        return "";
      })
      .join(" ");
  }
  return "";
}

function extractToolUses(contentArray: unknown[]): ToolUse[] {
  return contentArray
    .filter((c): c is Record<string, unknown> => c !== null && typeof c === "object")
    .filter((c) => c.type === "tool_use")
    .map((c) => ({
      id: c.id as string,
      name: c.name as string,
      input: c.input as Record<string, unknown>,
    }));
}

function extractToolResults(contentArray: unknown[]): ToolResult[] {
  return contentArray
    .filter((c): c is Record<string, unknown> => c !== null && typeof c === "object")
    .filter((c) => c.type === "tool_result")
    .map((c) => ({
      toolUseId: c.tool_use_id as string,
      content: typeof c.content === "string" ? c.content : JSON.stringify(c.content),
      isError: c.is_error === true,
    }));
}

function extractThinking(contentArray: unknown[]): ThinkingBlock[] {
  return contentArray
    .filter((c): c is Record<string, unknown> => c !== null && typeof c === "object")
    .filter((c) => c.type === "thinking")
    .map((c) => ({
      content: c.thinking as string,
    }));
}

export async function parseConversationFile(filePath: string): Promise<Conversation> {
  const messages: Message[] = [];
  const hookEvents: HookEvent[] = [];
  let summary: string | null = null;
  let startTime: Date | null = null;
  let endTime: Date | null = null;
  let sessionId = path.basename(filePath, ".jsonl");
  let gitBranch: string | null = null;
  let projectPath: string | null = null;

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

    if (record.type === "summary") {
      summary = (record.summary as string) || null;
      continue;
    }

    if (record.sessionId) sessionId = record.sessionId as string;
    if (record.gitBranch && !gitBranch) gitBranch = record.gitBranch as string;
    if (record.cwd && !projectPath) projectPath = record.cwd as string;

    if (record.timestamp) {
      const ts = new Date(record.timestamp as string);
      if (!startTime || ts < startTime) startTime = ts;
      if (!endTime || ts > endTime) endTime = ts;
    }

    if (record.type === "progress") {
      const data = record.data as Record<string, unknown> | undefined;
      if (data?.type === "hook" && data.hookName && data.hookEvent) {
        hookEvents.push({
          hookName: data.hookName as string,
          hookEvent: data.hookEvent as string,
          command: (data.command as string) || "",
          toolUseId: (record.toolUseID as string) || "",
          timestamp: record.timestamp ? new Date(record.timestamp as string) : null,
        });
      }
      continue;
    }

    if (record.type === "user" && !record.isMeta) {
      const message = record.message as Record<string, unknown> | undefined;
      if (message?.content) {
        const contentArray = Array.isArray(message.content) ? message.content : [message.content];
        const timestamp = record.timestamp as string | undefined;

        messages.push({
          role: "user",
          content: extractTextContent(message.content),
          toolUses: [],
          toolResults: extractToolResults(contentArray),
          thinking: [],
          ...(timestamp && { timestamp }),
        });
      }
    }

    if (record.type === "assistant") {
      const message = record.message as Record<string, unknown> | undefined;
      if (message?.content) {
        const contentArray = Array.isArray(message.content) ? message.content : [message.content];
        const timestamp = record.timestamp as string | undefined;

        messages.push({
          role: "assistant",
          content: extractTextContent(message.content),
          toolUses: extractToolUses(contentArray),
          toolResults: [],
          thinking: extractThinking(contentArray),
          ...(timestamp && { timestamp }),
        });
      }
    }
  }

  if (parseErrors > 0 && parseErrors === lines.length) {
    console.error(`Warning: Failed to parse any lines in ${filePath}`);
  }

  const projectName = projectPath ? path.basename(projectPath) : null;
  const durationMinutes =
    startTime && endTime ? Math.round((endTime.getTime() - startTime.getTime()) / 1000 / 60) : null;

  return {
    sessionId,
    projectPath,
    projectName,
    filePath,
    messages,
    hookEvents,
    summary,
    startTime,
    endTime,
    durationMinutes,
    gitBranch,
  };
}
