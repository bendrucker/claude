import type { ErrorAggregate, ToolError } from "./errors";
import type { SessionStats } from "./stats";
import {
  type Conversation,
  DISPLAY_LIMITS,
  type DigestResult,
  type ProjectStats,
  type SearchResult,
} from "./types";

const TIMESTAMP_FORMAT = "YYYY-MM-DD HH:MM";

function formatTimestamp(date: Date | null): string {
  if (!date) return "unknown";
  return date.toISOString().replace("T", " ").slice(0, TIMESTAMP_FORMAT.length);
}

export function formatDigest(conversations: Conversation[]): string {
  if (conversations.length === 0) {
    return "No conversations found.";
  }

  const lines: string[] = [];
  for (const conv of conversations) {
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

export function formatStats(stats: SessionStats): string {
  const lines: string[] = [];

  lines.push(`Sessions: ${stats.totalSessions}\n`);

  lines.push("Tool Usage:");
  const toolsSorted = [...stats.tools.entries()].sort((a, b) => b[1].uses - a[1].uses);
  for (const [name, data] of toolsSorted) {
    const errorRate = data.uses > 0 ? ((data.errors / data.uses) * 100).toFixed(1) : "0.0";
    lines.push(`  ${name}: ${data.uses} uses, ${data.errors} errors (${errorRate}%)`);
  }
  lines.push("");

  lines.push("Projects (by time):");
  const projectsSorted = [...stats.projects.entries()].sort(
    (a, b) => b[1].totalMinutes - a[1].totalMinutes,
  );
  for (const [projectPath, data] of projectsSorted) {
    const hours = Math.floor(data.totalMinutes / 60);
    const minutes = Math.round(data.totalMinutes % 60);
    lines.push(`  ${projectPath}`);
    lines.push(`    ${data.sessions} sessions, ${hours}h ${minutes}m`);
  }

  return lines.join("\n");
}
