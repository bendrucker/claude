import { table } from "table";
import type { ErrorAggregate, ToolError } from "./errors";
import { DISPLAY_LIMITS, type DigestResult, type ProjectStats, type SearchResult } from "./types";

const TIMESTAMP_FORMAT = "YYYY-MM-DD HH:MM";

function formatTimestamp(date: Date | null): string {
  if (!date) return "unknown";
  return date.toISOString().replace("T", " ").slice(0, TIMESTAMP_FORMAT.length);
}

export function formatDigest(result: DigestResult): string {
  if (result.conversations.length === 0) {
    return "No conversations found.";
  }

  const lines: string[] = [];

  if (result.truncated) {
    lines.push(
      `Warning: Showing ${result.conversations.length} of ${result.totalCount} sessions\n`,
    );
  }

  for (const conv of result.conversations) {
    const timestamp = formatTimestamp(conv.startTime);
    const project = conv.projectPath || "unknown";

    lines.push(`[${timestamp}] ${project}`);
    lines.push(`  ${conv.summary || "(no summary)"}`);
    if (conv.gitBranch) {
      lines.push(`  Branch: ${conv.gitBranch}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return "No matching conversations found.";
  }

  const lines: string[] = [];
  for (const result of results) {
    const conv = result.conversation;
    const timestamp = formatTimestamp(conv.startTime);
    const project = conv.projectPath || "unknown";

    lines.push(`[${timestamp}] (score: ${result.score.toFixed(2)}) ${project}`);
    if (conv.summary) {
      lines.push(`  Summary: ${conv.summary}`);
    }
    for (const match of result.matchedContent.slice(0, DISPLAY_LIMITS.matchedContentDisplay)) {
      const maxLen = DISPLAY_LIMITS.matchedLineLength;
      lines.push(`  - ${match.slice(0, maxLen)}${match.length > maxLen ? "..." : ""}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function formatErrors(errors: ToolError[]): string {
  if (errors.length === 0) {
    return "No tool errors found.";
  }

  const lines: string[] = [];
  lines.push(`Found ${errors.length} error${errors.length === 1 ? "" : "s"}:\n`);

  for (const error of errors) {
    const timestamp = formatTimestamp(error.timestamp);
    const preview = error.content.slice(0, 100).replace(/\n/g, " ");
    lines.push(`[${timestamp}] ${error.toolName}`);
    lines.push(`  ${preview}${error.content.length > 100 ? "..." : ""}`);
    lines.push(`  Session: ${error.sessionId}`);
    lines.push("");
  }

  return lines.join("\n");
}

export function formatErrorAggregates(aggregates: ErrorAggregate[]): string {
  if (aggregates.length === 0) {
    return "No tool errors found.";
  }

  const total = aggregates.reduce((sum, a) => sum + a.count, 0);
  const lines: string[] = [];
  lines.push(
    `Found ${total} error${total === 1 ? "" : "s"} in ${aggregates.length} unique patterns:\n`,
  );

  for (const aggregate of aggregates) {
    const preview = aggregate.content.slice(0, 80).replace(/\n/g, " ");
    lines.push(`${aggregate.count}x: ${preview}${aggregate.content.length > 80 ? "..." : ""}`);
    const tools = [...new Set(aggregate.examples.map((e) => e.toolName))].join(", ");
    lines.push(`   Tools: ${tools}`);
    lines.push("");
  }

  return lines.join("\n");
}

export function formatStats(stats: ProjectStats[]): string {
  if (stats.length === 0) {
    return "No sessions found.";
  }

  const totalSessions = stats.reduce((sum, s) => sum + s.sessionCount, 0);
  const totalMinutes = stats.reduce((sum, s) => sum + s.totalMinutes, 0);

  const data = [
    ["Project", "Sessions", "Minutes"],
    ...stats.map((s) => [s.projectName, s.sessionCount, s.totalMinutes]),
    ["Total", totalSessions, totalMinutes],
  ];

  return table(data);
}
