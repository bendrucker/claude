import { type Conversation, DISPLAY_LIMITS, type SearchResult } from "./types";

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
