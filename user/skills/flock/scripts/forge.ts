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

  const slug = path.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\.git$/, "");
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

export interface PullRequest {
  readonly branch: string;
  readonly number: number;
  readonly state: "open" | "draft" | "merged";
  readonly mergedAt: number | null;
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

/**
 * The merged query reaches only so far back, and a worktree older than the
 * window silently loses its `merged` marker rather than reporting one wrongly.
 */
export function mergedHorizonReached(
  merged: readonly PullRequest[],
  branchCommits: readonly (number | null)[],
): boolean {
  if (merged.length < MERGED_LIMIT) return false;
  const mergeTimes = merged.map((pull) => pull.mergedAt).filter((at): at is number => at !== null);
  const commits = branchCommits.filter((at): at is number => at !== null);
  if (mergeTimes.length === 0 || commits.length === 0) return false;
  return Math.min(...commits) < Math.min(...mergeTimes);
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
  }),
);

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
      const result = await run(["gh", "repo", "view", slug, "--json", "isFork,parent,nameWithOwner"]);
      if (!result.ok) return { slug, forkOf: null, resolved: false };
      try {
        const repo = decodeJson(GitHubRepo, result.stdout, "gh repo view");
        const parent = repo.parent === null || repo.parent === undefined
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
          "gh", "pr", "list",
          "--repo", slug,
          "--author", "@me",
          "--state", "open",
          "--limit", String(OPEN_LIMIT),
          "--json", "number,headRefName,isDraft",
        ]),
        run([
          "gh", "pr", "list",
          "--repo", slug,
          "--author", "@me",
          "--state", "merged",
          "--limit", String(MERGED_LIMIT),
          "--json", "number,headRefName,mergedAt",
        ]),
      ]);

      const read = (result: { ok: boolean; stdout: string }, state: "open" | "merged"): PullRequest[] | null => {
        if (!result.ok) return null;
        try {
          return decodeJson(GitHubPullRequests, result.stdout, "gh pr list").map((pull) => ({
            branch: pull.headRefName,
            number: pull.number,
            state: state === "merged" ? "merged" : pull.isDraft === true ? "draft" : "open",
            mergedAt: epochSeconds(pull.mergedAt),
          }));
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
  }),
);

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

      const base = ["glab", "mr", "list", "--repo", slug, "--author", me, "--per-page", String(MERGED_LIMIT)];
      const [open, merged] = await Promise.all([
        run([...base, "--output", "json"]),
        run([...base, "--merged", "--output", "json"]),
      ]);

      const read = (result: { ok: boolean; stdout: string }, state: "open" | "merged"): PullRequest[] | null => {
        if (!result.ok) return null;
        try {
          return decodeJson(GitLabMergeRequests, result.stdout, "glab mr list").map((request) => ({
            branch: request.source_branch,
            number: request.iid,
            state:
              state === "merged"
                ? "merged"
                : request.draft === true || request.work_in_progress === true
                  ? "draft"
                  : "open",
            mergedAt: epochSeconds(request.merged_at),
          }));
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
