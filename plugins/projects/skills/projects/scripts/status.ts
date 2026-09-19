import { getBorderCharacters, table } from "table";
import { leadName, type Project } from "./projects";
import { type DispatchLedgerRow, formatTags, hasTags, latestRows, OPEN } from "./threads";

export type LeadState = "live" | "none" | "unknown";

export interface ProjectStatus extends Project {
  lead: LeadState;
  open: number;
}

export interface Status {
  projects: ProjectStatus[];
  threads: DispatchLedgerRow[];
}

export function buildStatus(
  projects: readonly Project[],
  rows: readonly DispatchLedgerRow[],
  tags: Record<string, string>,
  live: ReadonlySet<string> | null,
): Status {
  const open = latestRows(rows).filter((row) => OPEN.has(row.outcome));
  return {
    projects: projects.map((project) => ({
      ...project,
      lead: live == null ? "unknown" : live.has(leadName(project.slug)) ? "live" : "none",
      open: open.filter((row) => row.tags?.project === project.slug).length,
    })),
    threads: open.filter((row) => hasTags(row, tags)),
  };
}

export function formatAge(ts: string, now: Date): string {
  const elapsed = now.getTime() - Date.parse(ts);
  if (Number.isNaN(elapsed)) return "?";
  const minutes = Math.max(0, Math.floor(elapsed / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function plain(rows: readonly (readonly string[])[]): string {
  return table(
    rows.map((row) => row.map((cell) => cell.replaceAll(/\s+/g, " ").trim())),
    {
      border: getBorderCharacters("void"),
      columnDefault: { paddingLeft: 0, paddingRight: 2 },
      drawHorizontalLine: () => false,
    },
  )
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trimEnd();
}

// Each block is one line per item, so a compaction hook can print it verbatim.
export function formatStatus(status: Status, now: Date): string {
  const projects =
    status.projects.length === 0
      ? "no projects"
      : plain(
          status.projects.map((project) => [
            project.slug,
            project.description,
            `lead:${project.lead}`,
            `open:${project.open}`,
          ]),
        );
  const threads =
    status.threads.length === 0
      ? "no open threads"
      : plain([
          ["branch", "state", "agent", "pane", "age", "pr", "tags"],
          ...status.threads.map((row) => [
            row.branch,
            row.outcome,
            row.agent ?? "-",
            row.pane,
            formatAge(row.ts, now),
            row.pr ?? "-",
            formatTags(row.tags),
          ]),
        ]);
  return `projects\n${projects}\n\nthreads\n${threads}\n`;
}
