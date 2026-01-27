import { createReadStream } from "node:fs";
import * as path from "node:path";
import { createInterface } from "node:readline";
import { isWithinDateRange, streamSessionFiles } from "./files";
import type { ErrorType, SearchOptions } from "./types";

const REJECTION_PATTERNS = [
  /^Interrupted by user$/,
  /^Permission to use .+ has been auto-denied$/,
  /^User rejected/,
  /^Tool use was rejected/,
];

function classifyError(content: string): ErrorType {
  for (const pattern of REJECTION_PATTERNS) {
    if (pattern.test(content)) {
      return "rejection";
    }
  }
  return "failure";
}

export interface ToolError {
  readonly content: string;
  readonly toolName: string;
  readonly sessionId: string;
  readonly projectPath: string | null;
  readonly timestamp: Date | null;
  readonly errorType: ErrorType;
}

export interface ErrorAggregate {
  readonly content: string;
  readonly count: number;
  readonly examples: readonly {
    readonly toolName: string;
    readonly sessionId: string;
    readonly projectPath: string | null;
  }[];
}

async function extractErrorsFromFile(
  filePath: string,
  options: SearchOptions,
): Promise<ToolError[]> {
  const errors: ToolError[] = [];
  const toolUseNames = new Map<string, string>();

  let sessionId = path.basename(filePath, ".jsonl");
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

    if (record.sessionId) sessionId = record.sessionId as string;
    if (record.cwd && !projectPath) projectPath = record.cwd as string;

    if (record.type === "assistant") {
      const message = record.message as Record<string, unknown> | undefined;
      if (message?.content && Array.isArray(message.content)) {
        for (const item of message.content) {
          if (item && typeof item === "object" && item.type === "tool_use") {
            toolUseNames.set(item.id as string, item.name as string);
          }
        }
      }
    }

    if (record.type === "user" && !record.isMeta) {
      const message = record.message as Record<string, unknown> | undefined;
      if (message?.content && Array.isArray(message.content)) {
        for (const item of message.content) {
          if (
            item &&
            typeof item === "object" &&
            item.type === "tool_result" &&
            item.is_error === true
          ) {
            const timestamp = record.timestamp ? new Date(record.timestamp as string) : null;

            if (!isWithinDateRange(timestamp, options)) continue;

            const toolUseId = item.tool_use_id as string;
            const toolName = toolUseNames.get(toolUseId) || "unknown";
            const content =
              typeof item.content === "string" ? item.content : JSON.stringify(item.content);

            const errorType = classifyError(content);

            if (options.errorType && options.errorType !== errorType) continue;

            errors.push({
              content,
              toolName,
              sessionId,
              projectPath,
              timestamp,
              errorType,
            });
          }
        }
      }
    }
  }

  return errors;
}

export async function getErrors(options: SearchOptions = {}): Promise<ToolError[]> {
  const allErrors: ToolError[] = [];
  const filePromises: Promise<ToolError[]>[] = [];

  for await (const filePath of streamSessionFiles(options)) {
    filePromises.push(extractErrorsFromFile(filePath, options));
  }

  const results = await Promise.all(filePromises);
  for (const errors of results) {
    allErrors.push(...errors);
  }

  allErrors.sort((a, b) => {
    if (!a.timestamp) return 1;
    if (!b.timestamp) return -1;
    return b.timestamp.getTime() - a.timestamp.getTime();
  });

  const limit = options.limit ?? 50;
  return allErrors.slice(0, limit);
}

export function aggregateErrors(errors: readonly ToolError[]): ErrorAggregate[] {
  const aggregates = new Map<string, { count: number; examples: ToolError[] }>();

  for (const error of errors) {
    const existing = aggregates.get(error.content);
    if (existing) {
      existing.count++;
      if (existing.examples.length < 3) {
        existing.examples.push(error);
      }
    } else {
      aggregates.set(error.content, { count: 1, examples: [error] });
    }
  }

  const results: ErrorAggregate[] = [];
  for (const [content, { count, examples }] of aggregates) {
    results.push({
      content,
      count,
      examples: examples.map((e) => ({
        toolName: e.toolName,
        sessionId: e.sessionId,
        projectPath: e.projectPath,
      })),
    });
  }

  results.sort((a, b) => b.count - a.count);
  return results;
}
