import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Conversation, Message, ToolUse } from "./types";

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

export async function parseConversationFile(filePath: string): Promise<Conversation> {
  const content = await fs.readFile(filePath, "utf-8");
  const lines = content.split("\n").filter((line) => line.trim());

  const messages: Message[] = [];
  let summary: string | null = null;
  let startTime: Date | null = null;
  let endTime: Date | null = null;
  let sessionId = path.basename(filePath, ".jsonl");
  let gitBranch: string | null = null;
  let projectPath: string | null = null;
  let parseErrors = 0;

  for (const line of lines) {
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      parseErrors++;
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

    if (record.type === "user" && !record.isMeta) {
      const message = record.message as Record<string, unknown> | undefined;
      if (message?.content) {
        const timestamp = record.timestamp as string | undefined;
        messages.push({
          role: "user",
          content: extractTextContent(message.content),
          toolUses: [],
          ...(timestamp && { timestamp }),
        });
      }
    }

    if (record.type === "assistant") {
      const message = record.message as Record<string, unknown> | undefined;
      if (message?.content) {
        const contentArray = Array.isArray(message.content) ? message.content : [message.content];

        const toolUses: ToolUse[] = contentArray
          .filter((c: Record<string, unknown>) => c.type === "tool_use")
          .map((c: Record<string, unknown>) => ({
            name: c.name as string,
            input: c.input as Record<string, unknown>,
          }));

        const timestamp = record.timestamp as string | undefined;
        messages.push({
          role: "assistant",
          content: extractTextContent(message.content),
          toolUses,
          ...(timestamp && { timestamp }),
        });
      }
    }
  }

  if (parseErrors > 0 && parseErrors === lines.length) {
    console.error(`Warning: Failed to parse any lines in ${filePath}`);
  }

  return {
    sessionId,
    projectPath,
    filePath,
    messages,
    summary,
    startTime,
    endTime,
    gitBranch,
  };
}
