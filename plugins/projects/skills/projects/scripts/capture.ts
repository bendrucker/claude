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

export type Resolution = "open" | "closed" | "unknown";

const TargetView = z.object({ state: z.string() });

// gh reads either from a URL, but not under the same subcommand.
const GITHUB_TARGET = /^\/[^/]+\/[^/]+\/(pull|issues)\/\d+/;

export async function resolveGitHub(
  url: URL,
  run: (argv: string[]) => Promise<string | null> = capture,
): Promise<Resolution> {
  const kind = GITHUB_TARGET.exec(url.pathname)?.[1];
  if (kind == null) return "unknown";
  const stdout = await run([
    "gh",
    kind === "pull" ? "pr" : "issue",
    "view",
    url.href,
    "--json",
    "state",
  ]);
  if (stdout == null) return "unknown";
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return "unknown";
  }
  const view = TargetView.safeParse(parsed);
  if (!view.success) return "unknown";
  const state = GH_STATES[view.data.state];
  if (state == null) return "unknown";
  return state === "open" ? "open" : "closed";
}

// A queue item points at whatever the work is tracked in, so the lookup is
// chosen by host, and a host with none resolves to nothing.
const RESOLVERS: Record<string, (url: URL) => Promise<Resolution>> = {
  "github.com": (url) => resolveGitHub(url),
};

interface Lookup {
  url: URL;
  resolve: (url: URL) => Promise<Resolution>;
}

export function resolverFor(url: string): Lookup | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const resolve = RESOLVERS[parsed.hostname];
  return resolve == null ? null : { url: parsed, resolve };
}

export function resolveUrl(url: string): Promise<Resolution> {
  const lookup = resolverFor(url);
  return lookup == null ? Promise.resolve<Resolution>("unknown") : lookup.resolve(lookup.url);
}

// Every url a resolver knows costs a subprocess, so a host nothing can read is
// left out.
export function readResolutions(
  urls: readonly string[],
  resolve: (url: string) => Promise<Resolution> = resolveUrl,
): Promise<ReadonlyMap<string, Resolution>> {
  return lookUp(
    urls.filter((url) => resolverFor(url) != null),
    resolve,
  );
}

// Every pull request costs a gh call, and one nobody has touched in a fortnight
// is not waiting on a review.
const PR_LOOKUP_MS = 14 * 24 * 60 * 60 * 1000;
// Each lookup is its own subprocess and watch mode sweeps on an interval, so
// the whole backlog must not spawn at once.
const LOOKUP_CONCURRENCY = 8;

async function lookUp<T>(
  urls: readonly string[],
  view: (url: string) => Promise<T>,
): Promise<ReadonlyMap<string, T>> {
  const looked = new Map<string, T>();
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let index = next++; index < urls.length; index = next++) {
      const url = urls[index];
      if (url == null) return;
      // oxlint-disable-next-line no-await-in-loop -- a worker takes the next url only once its own lookup returns, which is what bounds the fan-out.
      looked.set(url, await view(url));
    }
  };
  await Promise.all(Array.from({ length: Math.min(LOOKUP_CONCURRENCY, urls.length) }, worker));
  return looked;
}

// An abandoned or orphaned row leaves the board whatever its request says, so
// asking about one spends a gh process on an answer nothing reads.
function looksUpPullRequest(row: DispatchLedgerRow, now: Date): boolean {
  if (row.pr == null) return false;
  if (!OPEN.has(row.outcome) && row.outcome !== "done") return false;
  return now.getTime() - Date.parse(row.ts) < PR_LOOKUP_MS;
}

// A row whose timestamp will not parse is left out along with the ones that aged out.
export function readPullRequests(
  rows: readonly DispatchLedgerRow[],
  now: Date,
  view: (url: string) => Promise<PullRequest> = viewPullRequest,
): Promise<PullRequests> {
  return lookUp(
    [
      ...new Set(
        rows.flatMap((row) => (looksUpPullRequest(row, now) && row.pr != null ? [row.pr] : [])),
      ),
    ],
    view,
  );
}
