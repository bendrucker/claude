import { table } from "table";
import type { DigestRow, ErrorAggregate, ErrorRow, SearchRow, StatsRow } from "./types";

function formatTimestamp(ts: string | null): string {
  if (!ts) return "unknown";
  return ts.replace("T", " ").slice(0, 16);
}

export function formatDigest(rows: DigestRow[]): string {
  if (rows.length === 0) {
    return "No conversations found.";
  }

  const lines: string[] = [];

  for (const row of rows) {
    const timestamp = formatTimestamp(row.start_time);
    const project = row.project_path || "unknown";

    lines.push(`[${timestamp}] ${project}`);
    lines.push(`  ${row.summary || "(no summary)"}`);
    if (row.git_branch) {
      lines.push(`  Branch: ${row.git_branch}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function formatSearchResults(results: SearchRow[]): string {
  if (results.length === 0) {
    return "No matching conversations found.";
  }

  const lines: string[] = [];
  for (const row of results) {
    const timestamp = formatTimestamp(row.start_time);
    const project = row.project_path || "unknown";

    lines.push(`[${timestamp}] ${project}`);
    if (row.summary) {
      lines.push(`  Summary: ${row.summary}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function formatErrors(errors: ErrorRow[]): string {
  if (errors.length === 0) {
    return "No tool errors found.";
  }

  const lines: string[] = [];
  lines.push(`Found ${errors.length} error${errors.length === 1 ? "" : "s"}:\n`);

  for (const error of errors) {
    const timestamp = formatTimestamp(error.timestamp);
    const preview = error.error_content.slice(0, 100).replace(/\n/g, " ");
    lines.push(`[${timestamp}] ${error.tool_name}`);
    lines.push(`  ${preview}${error.error_content.length > 100 ? "..." : ""}`);
    lines.push(`  Session: ${error.session_id}`);
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
    const tools = [...new Set(aggregate.examples.map((e) => e.tool_name))].join(", ");
    lines.push(`   Tools: ${tools}`);
    lines.push("");
  }

  return lines.join("\n");
}

export function formatStats(rows: StatsRow[]): string {
  if (rows.length === 0) {
    return "No sessions found.";
  }

  const [first] = rows;
  const sections: string[] = [];

  sections.push(
    `${first.total_sessions} sessions, ${first.total_tool_uses} tool uses, ${first.total_errors} errors\n`,
  );

  const toolData = [
    ["Tool", "Uses", "Errors", "Error Rate"],
    ...rows.map((t) => [t.tool_name, t.uses, t.errors, `${t.error_rate_pct}%`]),
  ];
  sections.push(table(toolData));

  return sections.join("\n");
}
