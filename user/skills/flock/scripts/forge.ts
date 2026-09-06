import { z } from "zod";
import { decodeJson } from "../../../../packages/decode/index";
import type { Run } from "./exec";

export type ForgeKind = "github" | "gitlab";

export const OPEN_LIMIT = 60;
export const MERGED_LIMIT = 100;

export interface Remote {
  readonly host: string;
  readonly slug: string;
}

export function parseRemote(url: string): Remote | null {
  const trimmed = url.trim();
  if (trimmed === "") return null;

  let host: string;
  let path: string;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      host = parsed.hostname;
      path = parsed.pathname;
    } catch {
      return null;
    }
  } else {
    const scp = /^(?:[^@/]+@)?([^/:]+):(.+)$/.exec(trimmed);
    if (scp === null) return null;
    host = scp[1] ?? "";
    path = scp[2] ?? "";
  }

  const slug = path
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/, "");
  if (host === "" || !slug.includes("/")) return null;
  return { host: host.toLowerCase(), slug };
}

export function forgeKind(host: string, gitlabHost: string | null): ForgeKind | null {
  const normalized = host.toLowerCase();
  if (normalized === "github.com" || normalized.endsWith(".github.com")) return "github";
  if (normalized === "gitlab.com" || normalized.startsWith("gitlab.")) return "gitlab";
  if (gitlabHost !== null && normalized === gitlabHost.toLowerCase()) return "gitlab";
  return null;
}

export function slugParts(slug: string): { owner: string; repo: string } {
  const cut = slug.lastIndexOf("/");
  if (cut < 0) return { owner: "", repo: slug };
  return { owner: slug.slice(0, cut), repo: slug.slice(cut + 1) };
}

export function ownedBy(slug: string, viewer: string | null): boolean {
  if (viewer === null) return false;
  return (slug.split("/")[0] ?? "") === viewer;
}

/** How the forge's checks stand on a pull request the board did not open itself. */
export type CheckState = "passing" | "failing" | "running" | "none" | "unknown";

export type ReviewState = "approved" | "changes-requested" | "review-required" | "none" | "unknown";

export type MergeState =
  | "clean"
  | "conflicting"
  | "behind"
  | "blocked"
  | "unstable"
  | "draft"
  | "unknown";

/**
 * What the merge bar needs and the board cannot infer from a checkout. Only an
 * open pull request carries it. A merged one reports `none` and `unknown`,
 * because its disposition turns on the worktree beside it rather than on state
 * the forge has already settled.
 */
export interface PullState {
  readonly checks: CheckState;
  readonly failing: readonly string[];
  readonly review: ReviewState;
  readonly mergeState: MergeState;
}

export const SETTLED_STATE: PullState = {
  checks: "none",
  failing: [],
  review: "none",
  mergeState: "unknown",
};

export interface PullRequest extends PullState {
  readonly branch: string;
  readonly number: number;
  readonly state: "open" | "draft" | "merged";
  readonly mergedAt: number | null;
}

/** One entry of GitHub's `statusCheckRollup`, which mixes two shapes. */
export interface CheckEntry {
  readonly name?: string | undefined;
  readonly context?: string | undefined;
  readonly status?: string | null | undefined;
  readonly conclusion?: string | null | undefined;
  readonly state?: string | null | undefined;
}

const FAILED_CONCLUSIONS = new Set([
  "FAILURE",
  "TIMED_OUT",
  "CANCELLED",
  "ACTION_REQUIRED",
  "STARTUP_FAILURE",
  "STALE",
]);

function checkVerdict(check: CheckEntry): "passing" | "failing" | "running" {
  const status = check.status ?? "";
  const state = check.state ?? "";
  // A CheckRun reports `status` plus `conclusion`. A StatusContext reports only
  // `state`, and reading a missing `conclusion` as a pass would call a running
  // job green.
  if (status !== "" && status !== "COMPLETED") return "running";
  if (state === "FAILURE" || state === "ERROR") return "failing";
  if (FAILED_CONCLUSIONS.has(check.conclusion ?? "")) return "failing";
  if (state === "PENDING" || state === "EXPECTED") return "running";
  return "passing";
}

function checkName(check: CheckEntry): string {
  const named = check.name ?? check.context ?? "";
  return named === "" ? "check" : named;
}

/**
 * A failing job names itself so the report can say which one, and a single
 * failure outranks any number of passes: the bar is every required check
 * green, not most of them.
 */
export function rollUpChecks(checks: readonly CheckEntry[]): {
  checks: CheckState;
  failing: string[];
} {
  if (checks.length === 0) return { checks: "none", failing: [] };
  const verdicts = checks.map((check) => ({
    verdict: checkVerdict(check),
    name: checkName(check),
  }));
  const failing = [
    ...new Set(verdicts.filter((entry) => entry.verdict === "failing").map((entry) => entry.name)),
  ].toSorted();
  if (failing.length > 0) return { checks: "failing", failing };
  const running = verdicts.some((entry) => entry.verdict === "running");
  return { checks: running ? "running" : "passing", failing: [] };
}

const REVIEW_DECISIONS: Record<string, ReviewState> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes-requested",
  REVIEW_REQUIRED: "review-required",
};

/** GitHub returns an empty decision where the repository requires no review. */
export function reviewState(decision: string | null | undefined): ReviewState {
  const raw = decision ?? "";
  if (raw === "") return "none";
  return REVIEW_DECISIONS[raw] ?? "unknown";
}

const MERGE_STATES: Record<string, MergeState> = {
  CLEAN: "clean",
  HAS_HOOKS: "clean",
  DIRTY: "conflicting",
  BEHIND: "behind",
  BLOCKED: "blocked",
  UNSTABLE: "unstable",
  DRAFT: "draft",
};

export function mergeState(status: string | null | undefined): MergeState {
  return MERGE_STATES[status ?? ""] ?? "unknown";
}

const GITLAB_MERGE_STATES: Record<string, MergeState> = {
  mergeable: "clean",
  conflict: "conflicting",
  broken_status: "conflicting",
  need_rebase: "behind",
  not_approved: "blocked",
  discussions_not_resolved: "blocked",
  blocked_status: "blocked",
  draft_status: "draft",
  ci_must_pass: "unstable",
  ci_still_running: "unstable",
};

export function gitlabMergeState(
  detailed: string | null | undefined,
  hasConflicts: boolean | undefined,
): MergeState {
  if (hasConflicts === true) return "conflicting";
  return GITLAB_MERGE_STATES[detailed ?? ""] ?? "unknown";
}

const GITLAB_PIPELINE_STATES: Record<string, CheckState> = {
  success: "passing",
  skipped: "passing",
  manual: "passing",
  failed: "failing",
  canceled: "failing",
  created: "running",
  waiting_for_resource: "running",
  preparing: "running",
  pending: "running",
  running: "running",
  scheduled: "running",
};

/**
 * The merge-request listing carries a pipeline summary but never the job
 * names behind it, so a GitLab failure is reported without one.
 */
export function gitlabChecks(status: string | null | undefined): CheckState {
  const raw = status ?? "";
  if (raw === "") return "unknown";
  return GITLAB_PIPELINE_STATES[raw] ?? "unknown";
}

export function pullRequestRef(pull: PullRequest): string {
  const prefix = pull.state === "open" ? "#" : `${pull.state}#`;
  return `${prefix}${pull.number}`;
}

/**
 * A branch reused after its pull request merged appears in both listings, and
 * the open row is the truthful one.
 */
export function joinPullRequests(
  open: readonly PullRequest[],
  merged: readonly PullRequest[],
): Map<string, PullRequest> {
  const byBranch = new Map<string, PullRequest>();
  for (const pull of [...open, ...merged]) {
    if (!byBranch.has(pull.branch)) byBranch.set(pull.branch, pull);
  }
  return byBranch;
}

export interface HorizonCandidate {
  readonly branch: string;
  readonly commit: number | null;
  readonly matched: boolean;
}

/**
 * The merged query reaches only so far back. A branch that already matched a
 * pull request is settled whatever its age, so only an unmatched branch older
 * than the window is genuinely unflagged, and naming those is what makes the
 * warning worth acting on.
 */
export function beyondMergedHorizon(
  merged: readonly PullRequest[],
  candidates: readonly HorizonCandidate[],
): string[] {
  if (merged.length < MERGED_LIMIT) return [];
  const mergeTimes = merged.map((pull) => pull.mergedAt).filter((at): at is number => at !== null);
  if (mergeTimes.length === 0) return [];
  const oldest = Math.min(...mergeTimes);
  return candidates
    .filter(({ matched, commit }) => !matched && commit !== null && commit < oldest)
    .map(({ branch }) => branch)
    .toSorted();
}

export interface PullRequestListing {
  readonly open: PullRequest[] | null;
  readonly merged: PullRequest[] | null;
}

export interface ForgeIdentity {
  readonly slug: string;
  readonly forkOf: string | null;
  readonly resolved: boolean;
}

export interface Forge {
  readonly kind: ForgeKind;
  viewer: () => Promise<string | null>;
  identity: (slug: string) => Promise<ForgeIdentity>;
  pullRequests: (slug: string) => Promise<PullRequestListing>;
}

function epochSeconds(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : Math.floor(parsed / 1000);
}

function memo<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    pending ??= load();
    return pending;
  };
}

const GitHubUser = z.looseObject({ login: z.string() });

// `--json parent` returns the parent as name plus owner login rather than the
// `nameWithOwner` the top level uses.
const GitHubRepo = z.looseObject({
  isFork: z.boolean(),
  nameWithOwner: z.string(),
  parent: z
    .looseObject({ name: z.string(), owner: z.looseObject({ login: z.string() }) })
    .nullish(),
});

const GitHubPullRequests = z.array(
  z.looseObject({
    number: z.number(),
    headRefName: z.string(),
    isDraft: z.boolean().optional(),
    mergedAt: z.string().nullish(),
    mergeStateStatus: z.string().nullish(),
    reviewDecision: z.string().nullish(),
    statusCheckRollup: z
      .array(
        z.looseObject({
          name: z.string().optional(),
          context: z.string().optional(),
          status: z.string().nullish(),
          conclusion: z.string().nullish(),
          state: z.string().nullish(),
        }),
      )
      .nullish(),
  }),
);

// Requested only on the open query. The merged query returns a hundred rows
// whose check history no disposition reads, and asking for a rollup there
// would multiply the response for nothing.
const OPEN_FIELDS = "number,headRefName,isDraft,mergeStateStatus,reviewDecision,statusCheckRollup";

function githubPullRequest(
  pull: z.infer<typeof GitHubPullRequests>[number],
  state: "open" | "merged",
): PullRequest {
  const identity = {
    branch: pull.headRefName,
    number: pull.number,
    state: state === "merged" ? "merged" : pull.isDraft === true ? "draft" : "open",
    mergedAt: epochSeconds(pull.mergedAt),
  } as const;
  if (state === "merged") return { ...identity, ...SETTLED_STATE };

  const rollup = pull.statusCheckRollup;
  const checks =
    rollup === null || rollup === undefined
      ? { checks: "unknown" as const, failing: [] }
      : rollUpChecks(rollup);
  return {
    ...identity,
    ...checks,
    review: reviewState(pull.reviewDecision),
    mergeState: mergeState(pull.mergeStateStatus),
  };
}

function githubForge(run: Run): Forge {
  const viewer = memo(async (): Promise<string | null> => {
    const result = await run(["gh", "api", "user"]);
    if (!result.ok) return null;
    try {
      return decodeJson(GitHubUser, result.stdout, "gh api user").login;
    } catch {
      return null;
    }
  });

  return {
    kind: "github",
    viewer,
    identity: async (slug) => {
      const result = await run([
        "gh",
        "repo",
        "view",
        slug,
        "--json",
        "isFork,parent,nameWithOwner",
      ]);
      if (!result.ok) return { slug, forkOf: null, resolved: false };
      try {
        const repo = decodeJson(GitHubRepo, result.stdout, "gh repo view");
        const parent =
          repo.parent === null || repo.parent === undefined
            ? undefined
            : `${repo.parent.owner.login}/${repo.parent.name}`;
        if (repo.isFork && parent !== undefined) {
          return { slug: parent, forkOf: repo.nameWithOwner, resolved: true };
        }
        return { slug: repo.nameWithOwner, forkOf: null, resolved: true };
      } catch {
        return { slug, forkOf: null, resolved: false };
      }
    },
    pullRequests: async (slug) => {
      const [open, merged] = await Promise.all([
        run([
          "gh",
          "pr",
          "list",
          "--repo",
          slug,
          "--author",
          "@me",
          "--state",
          "open",
          "--limit",
          String(OPEN_LIMIT),
          "--json",
          OPEN_FIELDS,
        ]),
        run([
          "gh",
          "pr",
          "list",
          "--repo",
          slug,
          "--author",
          "@me",
          "--state",
          "merged",
          "--limit",
          String(MERGED_LIMIT),
          "--json",
          "number,headRefName,mergedAt",
        ]),
      ]);

      const read = (
        result: { ok: boolean; stdout: string },
        state: "open" | "merged",
      ): PullRequest[] | null => {
        if (!result.ok) return null;
        try {
          return decodeJson(GitHubPullRequests, result.stdout, "gh pr list").map((pull) =>
            githubPullRequest(pull, state),
          );
        } catch {
          return null;
        }
      };

      return { open: read(open, "open"), merged: read(merged, "merged") };
    },
  };
}

const GitLabUser = z.looseObject({ username: z.string() });

const GitLabProject = z.looseObject({
  path_with_namespace: z.string(),
  forked_from_project: z.looseObject({ path_with_namespace: z.string() }).nullish(),
});

const GitLabMergeRequests = z.array(
  z.looseObject({
    iid: z.number(),
    source_branch: z.string(),
    draft: z.boolean().optional(),
    work_in_progress: z.boolean().optional(),
    merged_at: z.string().nullish(),
    has_conflicts: z.boolean().optional(),
    detailed_merge_status: z.string().nullish(),
    pipeline: z.looseObject({ status: z.string().nullish() }).nullish(),
  }),
);

function gitlabMergeRequest(
  request: z.infer<typeof GitLabMergeRequests>[number],
  state: "open" | "merged",
): PullRequest {
  const identity = {
    branch: request.source_branch,
    number: request.iid,
    state:
      state === "merged"
        ? "merged"
        : request.draft === true || request.work_in_progress === true
          ? "draft"
          : "open",
    mergedAt: epochSeconds(request.merged_at),
  } as const;
  if (state === "merged") return { ...identity, ...SETTLED_STATE };

  return {
    ...identity,
    checks: gitlabChecks(request.pipeline?.status),
    failing: [],
    // The listing carries no approval decision, and a review the board cannot
    // read must not pass for one it has cleared.
    review: "unknown",
    mergeState: gitlabMergeState(request.detailed_merge_status, request.has_conflicts),
  };
}

function gitlabForge(run: Run): Forge {
  const viewer = memo(async (): Promise<string | null> => {
    const result = await run(["glab", "api", "user"]);
    if (!result.ok) return null;
    try {
      return decodeJson(GitLabUser, result.stdout, "glab api user").username;
    } catch {
      return null;
    }
  });

  return {
    kind: "gitlab",
    viewer,
    identity: async (slug) => {
      const result = await run(["glab", "repo", "view", slug, "--output", "json"]);
      if (!result.ok) return { slug, forkOf: null, resolved: false };
      try {
        const project = decodeJson(GitLabProject, result.stdout, "glab repo view");
        const parent = project.forked_from_project?.path_with_namespace;
        if (parent !== undefined) {
          return { slug: parent, forkOf: project.path_with_namespace, resolved: true };
        }
        return { slug: project.path_with_namespace, forkOf: null, resolved: true };
      } catch {
        return { slug, forkOf: null, resolved: false };
      }
    },
    pullRequests: async (slug) => {
      // --author takes a username, so an unresolved viewer would widen the
      // query past the pull requests the board is allowed to act on.
      const me = await viewer();
      if (me === null) return { open: null, merged: null };

      const base = [
        "glab",
        "mr",
        "list",
        "--repo",
        slug,
        "--author",
        me,
        "--per-page",
        String(MERGED_LIMIT),
      ];
      const [open, merged] = await Promise.all([
        run([...base, "--output", "json"]),
        run([...base, "--merged", "--output", "json"]),
      ]);

      const read = (
        result: { ok: boolean; stdout: string },
        state: "open" | "merged",
      ): PullRequest[] | null => {
        if (!result.ok) return null;
        try {
          return decodeJson(GitLabMergeRequests, result.stdout, "glab mr list").map((request) =>
            gitlabMergeRequest(request, state),
          );
        } catch {
          return null;
        }
      };

      return { open: read(open, "open"), merged: read(merged, "merged") };
    },
  };
}

export function createForge(kind: ForgeKind, run: Run): Forge {
  return kind === "github" ? githubForge(run) : gitlabForge(run);
}
