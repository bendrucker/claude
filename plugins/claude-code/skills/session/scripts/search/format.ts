import { DISPLAY_LIMITS, type DigestResult, type ProjectStats, type SearchResult } from "./types";

const TIMESTAMP_FORMAT = "YYYY-MM-DD HH:MM";

function formatTimestamp(date: Date | null): string {
  if (!date) return "unknown";
  return date.toISOString().replace("T", " ").slice(0, TIMESTAMP_FORMAT.length);
}

export function formatDigest(result: DigestResult): string {
  const { conversations, totalCount, truncated } = result;

  if (conversations.length === 0) {
    return "No conversations found.";
  }

  const lines: string[] = [];

  if (truncated) {
    lines.push(
      `Warning: Showing ${conversations.length} of ${totalCount} sessions. Use --limit ${totalCount} to see all.`,
    );
    lines.push("");
  }

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

export function formatStats(stats: ProjectStats[]): string {
  if (stats.length === 0) {
    return "No sessions found.";
  }

  const lines: string[] = [];
  lines.push("Project                                  Sessions    Minutes");
  lines.push("─".repeat(60));

  for (const stat of stats) {
    const name = stat.projectName.slice(0, 38).padEnd(38);
    const sessions = stat.sessionCount.toString().padStart(8);
    const minutes = stat.totalMinutes.toString().padStart(10);
    lines.push(`${name} ${sessions} ${minutes}`);
  }

  lines.push("─".repeat(60));
  const totalSessions = stats.reduce((sum, s) => sum + s.sessionCount, 0);
  const totalMinutes = stats.reduce((sum, s) => sum + s.totalMinutes, 0);
  const totalLine = `${"Total".padEnd(38)} ${totalSessions.toString().padStart(8)} ${totalMinutes.toString().padStart(10)}`;
  lines.push(totalLine);

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
