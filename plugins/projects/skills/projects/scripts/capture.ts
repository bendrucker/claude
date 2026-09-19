import { z } from "zod";
import { type DispatchLedgerRow, OPEN } from "./threads";

// A wedged herdr server leaves `herdr agent list` with nothing to say, and
// status prints nothing until it answers. Both callers read a failure as
// unknown, so the deadline lands on a path that exists. SIGKILL, because a
// process that ignores SIGTERM would keep the deadline from binding.
export const CAPTURE_TIMEOUT_MS = 5_000;

export async function capture(
  argv: string[],
  timeout: number = CAPTURE_TIMEOUT_MS,
): Promise<string | null> {
  let proc: Bun.Subprocess<"ignore", "pipe", "ignore">;
  try {
    proc = Bun.spawn(argv, {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
      timeout,
      killSignal: "SIGKILL",
    });
  } catch {
    return null;
  }
  const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return code === 0 ? stdout : null;
}

// dispatch records a thread against the primary worktree, which git lists
// first, so an outcome typed from a linked worktree or a subdirectory folds
// onto the same thread. A path git does not know is returned as given.
export async function primaryRoot(repo: string): Promise<string> {
  const listing = await capture(["git", "-C", repo, "worktree", "list", "--porcelain"]);
  const root = listing
    ?.split("\n")
    .find((line) => line.startsWith("worktree "))
    ?.slice("worktree ".length)
    .trim();
  return root == null || root === "" ? repo : root;
}

const AgentList = z.object({
  result: z.object({
    agents: z.array(
      z.object({
        name: z.string().nullish(),
        pane_id: z.string().nullish(),
        agent_status: z.string().nullish(),
        agent_session: z.object({ value: z.string().nullish() }).nullish(),
      }),
    ),
  }),
});

export interface Agent {
  name: string | null;
  status: string;
}

export interface Agents {
  names: ReadonlySet<string>;
  panes: ReadonlyMap<string, Agent>;
  sessions: ReadonlyMap<string, Agent>;
}

// Null when herdr cannot answer, which is not the same as no agents.
export async function listAgents(): Promise<Agents | null> {
  const stdout = await capture(["herdr", "agent", "list"]);
  if (stdout == null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  const listed = AgentList.safeParse(parsed);
  if (!listed.success) return null;
  const names = new Set<string>();
  const panes = new Map<string, Agent>();
  const sessions = new Map<string, Agent>();
  for (const listing of listed.data.result.agents) {
    const agent: Agent = {
      name: listing.name ?? null,
      status: listing.agent_status ?? "unknown",
    };
    if (listing.name != null) names.add(listing.name);
    if (listing.pane_id != null) panes.set(listing.pane_id, agent);
    if (listing.agent_session?.value != null) sessions.set(listing.agent_session.value, agent);
  }
  return { names, panes, sessions };
}

export type PullRequestState = "open" | "merged" | "closed" | "unknown";

export interface PullRequest {
  state: PullRequestState;
  approved: boolean;
  draft: boolean;
}

export type PullRequests = ReadonlyMap<string, PullRequest>;

const UNKNOWN_PR: PullRequest = { state: "unknown", approved: false, draft: false };

const GH_STATES: Record<string, PullRequestState> = {
  OPEN: "open",
  MERGED: "merged",
  CLOSED: "closed",
};

const PullRequestView = z.object({
  state: z.string(),
  reviewDecision: z.string().nullish(),
  isDraft: z.boolean().nullish(),
});

// An unreachable or unauthenticated gh leaves the state unknown, which every
// caller reads as "no evidence" rather than "nothing to do", so a machine
// offline still gets a status.
export async function viewPullRequest(url: string): Promise<PullRequest> {
  const stdout = await capture(["gh", "pr", "view", url, "--json", "state,reviewDecision,isDraft"]);
  if (stdout == null) return UNKNOWN_PR;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return UNKNOWN_PR;
  }
  const view = PullRequestView.safeParse(parsed);
  if (!view.success) return UNKNOWN_PR;
  return {
    state: GH_STATES[view.data.state] ?? "unknown",
    approved: view.data.reviewDecision === "APPROVED",
    draft: view.data.isDraft === true,
  };
}

// Every pull request costs a gh call, and one nobody has touched in a fortnight
// is not waiting on a review.
const PR_LOOKUP_MS = 14 * 24 * 60 * 60 * 1000;
// Each lookup is its own gh process and watch mode sweeps on an interval, so
// the whole backlog must not spawn at once.
const PR_CONCURRENCY = 8;

// An abandoned or orphaned row leaves the board whatever its request says, so
// asking about one spends a gh process on an answer nothing reads.
function looksUpPullRequest(row: DispatchLedgerRow, now: Date): boolean {
  if (row.pr == null) return false;
  if (!OPEN.has(row.outcome) && row.outcome !== "done") return false;
  return now.getTime() - Date.parse(row.ts) < PR_LOOKUP_MS;
}

// A row whose timestamp will not parse is left out along with the ones that aged out.
export async function readPullRequests(
  rows: readonly DispatchLedgerRow[],
  now: Date,
  view: (url: string) => Promise<PullRequest> = viewPullRequest,
): Promise<PullRequests> {
  const urls = [
    ...new Set(
      rows.flatMap((row) => (looksUpPullRequest(row, now) && row.pr != null ? [row.pr] : [])),
    ),
  ];
  const looked = new Map<string, PullRequest>();
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let index = next++; index < urls.length; index = next++) {
      const url = urls[index];
      if (url == null) return;
      // oxlint-disable-next-line no-await-in-loop -- a worker takes the next url only once its own lookup returns, which is what bounds the fan-out.
      looked.set(url, await view(url));
    }
  };
  await Promise.all(Array.from({ length: Math.min(PR_CONCURRENCY, urls.length) }, worker));
  return looked;
}
