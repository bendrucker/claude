import { getBorderCharacters, table } from "table";
import type { Agent, Agents, PullRequest, PullRequests } from "./capture";
import { leadName, type Project } from "./projects";
import { type DispatchLedgerRow, formatTags, hasTags, latestRows, OPEN } from "./threads";

export type LeadState = "live" | "none" | "unknown";

// What a thread wants from Ben, in the order he should work through them.
export const NEEDS = [
  "waiting-on-you",
  "ready-for-review",
  "landing",
  "working",
  "idle",
  "stale",
] as const;
export type Need = (typeof NEEDS)[number];

const STALE_MS = 7 * 24 * 60 * 60 * 1000;

export interface Thread extends DispatchLedgerRow {
  need: Need;
  prState?: PullRequest;
}

export interface Observed {
  agents: Agents | null;
  pullRequests: PullRequests;
  now: Date;
}

// A session outlives the pane it started in, so an agent herdr still reports
// under the dispatched session is the thread's agent wherever it now sits.
// Falling back to the pane covers a row dispatched before a session existed,
// and a pane now holding someone else, or nobody, has lost its agent.
function agentFor(row: DispatchLedgerRow, agents: Agents): Agent | null {
  const session = row.session == null ? undefined : agents.sessions.get(row.session);
  if (session != null) return session;
  const agent = agents.panes.get(row.pane);
  if (agent == null) return null;
  return row.agent == null || agent.name === row.agent ? agent : null;
}

function needOf(
  row: DispatchLedgerRow,
  agent: Agent | null,
  gone: boolean,
  pr: PullRequest | undefined,
  now: Date,
): Need {
  if (agent?.status === "blocked") return "waiting-on-you";
  // Only an outcome row clears the delivery flag, and every outcome closes the
  // thread, so a dispatch that got its prompt after the dialog carries the flag
  // for the rest of its life. An agent herdr now reports working took the work.
  if (row.prompted === false && agent?.status !== "working") return "waiting-on-you";
  if (row.outcome === "blocked") return "waiting-on-you";
  if (pr?.state === "merged" || pr?.state === "closed") return "landing";
  if (pr?.state === "open") {
    if (pr.approved) return "landing";
    if (!pr.draft) return "ready-for-review";
  }
  // A done thread only survives to here with a pull request gh could not read,
  // and the ledger's own evidence for it is that the work finished behind one.
  if (pr?.state === "unknown" && row.outcome === "done") return "ready-for-review";
  // Age outranks the pane-gone case below and nothing above it: a week-old
  // dispatch whose agent is gone has no one left to answer its prompt.
  if (gone && now.getTime() - Date.parse(row.ts) > STALE_MS) return "stale";
  if (gone && row.outcome === "dispatched") return "waiting-on-you";
  if (agent?.status === "working") return "working";
  return "idle";
}

function landingNote(pr: PullRequest): string {
  if (pr.state === "merged") return "pr merged, record the outcome";
  if (pr.state === "closed") return "pr closed, record the outcome";
  return "pr approved";
}

// A request gh could not read leaves the thread standing, because losing one is
// worse than carrying one whose request has already landed. A row past the
// lookup window is never asked about and drops.
function wantsReview(pr: PullRequest | undefined): boolean {
  return pr != null && pr.state !== "merged" && pr.state !== "closed";
}

function deriveThread(row: DispatchLedgerRow, observed: Observed): Thread | null {
  const pr = row.pr == null ? undefined : observed.pullRequests.get(row.pr);
  if (!OPEN.has(row.outcome) && !(row.outcome === "done" && wantsReview(pr))) return null;
  const agent = observed.agents == null ? null : agentFor(row, observed.agents);
  const gone = observed.agents != null && agent == null;
  const need = needOf(row, agent, gone, pr, observed.now);
  const thread: Thread = { ...row, need };
  if (pr != null) thread.prState = pr;
  if (need === "landing" && pr != null) thread.note = landingNote(pr);
  return thread;
}

export interface ProjectStatus extends Project {
  lead: LeadState;
  open: number;
}

export interface Status {
  projects: ProjectStatus[];
  threads: Thread[];
}

export function buildStatus(
  projects: readonly Project[],
  rows: readonly DispatchLedgerRow[],
  tags: Record<string, string>,
  observed: Observed,
): Status {
  const live = observed.agents?.names ?? null;
  const threads = latestRows(rows).flatMap((row) => deriveThread(row, observed) ?? []);
  return {
    projects: projects.map((project) => ({
      ...project,
      lead: live == null ? "unknown" : live.has(leadName(project.slug)) ? "live" : "none",
      open: threads.filter((row) => row.tags?.project === project.slug).length,
    })),
    threads: threads
      .filter((row) => hasTags(row, tags))
      .toSorted((a, b) => NEEDS.indexOf(a.need) - NEEDS.indexOf(b.need)),
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

// Every value here is written straight to a terminal, and the ledger carries
// whatever a dispatched agent wrote, so escape and format bytes go before the
// whitespace does. A newline additionally makes table() emit more lines than it
// was given rows, which slides every later row under the wrong header.
export function oneLine(value: string): string {
  return value
    .replaceAll(/[\p{Cc}\p{Cf}]/gu, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function plain(rows: readonly (readonly string[])[]): string {
  return table(
    rows.map((row) => row.map(oneLine)),
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
          ["branch", "need", "state", "agent", "pane", "age", "pr", "tags", "note"],
          ...status.threads.map((row) => [
            row.branch,
            row.need,
            row.outcome,
            row.agent ?? "-",
            row.pane,
            formatAge(row.ts, now),
            row.pr ?? "-",
            formatTags(row.tags),
            row.note ?? "",
          ]),
        ]);
  return `projects\n${projects}\n\nthreads\n${threads}\n`;
}
