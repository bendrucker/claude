#!/usr/bin/env bun

import { cli } from "cleye";

const QUERY = `
query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
  viewer { login }
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      title
      author { login }
      reviews(last: 50) {
        nodes {
          author { login __typename }
          submittedAt
          state
        }
      }
      reviewThreads(first: 100, after: $cursor) {
        totalCount
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          isResolved
          isOutdated
          path
          line
          startLine
          comments(first: 50) {
            nodes {
              author { login }
              body
              createdAt
            }
          }
        }
      }
    }
  }
}
`;

export interface Comment {
  author: { login: string } | null;
  body: string;
  createdAt: string;
}

export interface Thread {
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  line: number | null;
  startLine: number | null;
  comments: { nodes: Comment[] };
}

export interface Review {
  author: { login: string; __typename: string } | null;
  submittedAt: string;
  state: string;
}

export type Role = "author" | "reviewer";

export function parseUrl(url: string): {
  owner: string;
  repo: string;
  number: number;
} {
  const parsed = new URL(url);
  const parts = parsed.pathname.split("/").filter(Boolean);
  const owner = parts[0];
  const repo = parts[1];
  const number = Number.parseInt(parts[3] ?? "", 10);

  if (!owner || !repo || parts[2] !== "pull" || Number.isNaN(number)) {
    throw new Error(`Invalid PR URL: ${url}`);
  }

  return { owner, repo, number };
}

export function detectRole(viewer: string, prAuthor: string): Role {
  return viewer === prAuthor ? "author" : "reviewer";
}

export function filterThreads(
  threads: Thread[],
  options: {
    role: Role;
    viewer: string;
    since?: Date;
  },
): Thread[] {
  let filtered = threads.filter((t) => !t.isResolved);

  if (options.role === "reviewer") {
    filtered = filtered.filter((t) => t.comments.nodes[0]?.author?.login === options.viewer);
  }

  if (options.since) {
    const since = options.since;
    filtered = filtered.filter((t) => t.comments.nodes.some((c) => new Date(c.createdAt) > since));
  }

  return filtered;
}

export function findLastReviewDate(reviews: Review[], viewer: string, role: Role): Date | null {
  const relevant =
    role === "author"
      ? reviews.filter((r) => r.author?.__typename === "User" && r.author.login !== viewer)
      : reviews.filter((r) => r.author?.login === viewer);

  const sorted = relevant.sort(
    (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime(),
  );

  return sorted.length > 0 ? new Date(sorted[0]!.submittedAt) : null;
}

export function formatThreads(
  threads: Thread[],
  totalCount: number,
  options: { title: string; role: Role; viewer: string },
): string {
  const lines: string[] = [];
  lines.push(`# ${options.title}`);
  lines.push("");
  lines.push(`${threads.length} unresolved of ${totalCount} total threads`);
  if (options.role === "reviewer") {
    lines.push(`Showing threads started by @${options.viewer}`);
  }
  lines.push("");

  if (threads.length === 0) {
    lines.push("No unresolved threads found.");
    return lines.join("\n");
  }

  const byFile = new Map<string, Thread[]>();
  for (const thread of threads) {
    const existing = byFile.get(thread.path) ?? [];
    existing.push(thread);
    byFile.set(thread.path, existing);
  }

  for (const [path, fileThreads] of byFile) {
    lines.push(`## ${path}`);
    lines.push("");

    for (const thread of fileThreads) {
      const lineInfo = thread.startLine
        ? `Lines ${thread.startLine}\u2013${thread.line}`
        : thread.line
          ? `Line ${thread.line}`
          : "File-level";

      const outdated = thread.isOutdated ? " (outdated)" : "";
      lines.push(`### ${lineInfo}${outdated}`);
      lines.push("");

      for (const comment of thread.comments.nodes) {
        const author = comment.author?.login ?? "ghost";
        const date = comment.createdAt.split("T")[0];
        lines.push(`**@${author}** (${date}):`);
        const body = comment.body.trim();
        lines.push(
          `${body
            .split("\n")
            .map((l) => `> ${l}`)
            .join("\n")}`,
        );
        lines.push("");
      }

      lines.push("---");
      lines.push("");
    }
  }

  return lines.join("\n");
}

interface GraphQLResponse {
  data: {
    viewer: { login: string };
    repository: {
      pullRequest: {
        title: string;
        author: { login: string };
        reviews: { nodes: Review[] };
        reviewThreads: {
          totalCount: number;
          pageInfo: { hasNextPage: boolean; endCursor: string };
          nodes: Thread[];
        };
      };
    };
  };
}

async function fetchGraphQL(
  query: string,
  variables: Record<string, unknown>,
): Promise<GraphQLResponse> {
  const args = ["gh", "api", "graphql", "-f", `query=${query}`];
  for (const [key, value] of Object.entries(variables)) {
    if (value != null) {
      const flag = typeof value === "number" ? "-F" : "-f";
      args.push(flag, `${key}=${value}`);
    }
  }

  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`gh api graphql failed: ${stderr}`);
  }

  return JSON.parse(stdout);
}

async function main(): Promise<void> {
  const argv = cli({
    name: "pr-comments",
    parameters: ["<url>"],
    flags: {
      role: {
        type: String,
        description: "author or reviewer (default: auto-detect)",
      },
      since: {
        type: String,
        description: 'ISO date or "last-review"',
      },
    },
  });

  const { owner, repo, number } = parseUrl(argv._.url);

  const allThreads: Thread[] = [];
  let cursor: string | undefined;
  let totalCount = 0;
  let prTitle = "";
  let prAuthor = "";
  let viewer = "";
  let reviews: Review[] = [];

  do {
    const variables: Record<string, unknown> = { owner, repo, number };
    if (cursor) variables.cursor = cursor;

    const result = await fetchGraphQL(QUERY, variables);
    const pr = result.data.repository.pullRequest;

    if (!prTitle) {
      viewer = result.data.viewer.login;
      prTitle = pr.title;
      prAuthor = pr.author.login;
      reviews = pr.reviews.nodes;
      totalCount = pr.reviewThreads.totalCount;
    }

    allThreads.push(...pr.reviewThreads.nodes);

    const pageInfo = pr.reviewThreads.pageInfo;
    cursor = pageInfo.hasNextPage ? pageInfo.endCursor : undefined;
  } while (cursor);

  const role: Role = (argv.flags.role as Role) ?? detectRole(viewer, prAuthor);

  let since: Date | undefined;
  if (argv.flags.since) {
    if (argv.flags.since === "last-review") {
      const date = findLastReviewDate(reviews, viewer, role);
      if (!date) {
        console.error("No relevant reviews found");
        process.exit(1);
      }
      since = date;
    } else {
      since = new Date(argv.flags.since);
    }
  }

  const filtered = filterThreads(allThreads, { role, viewer, ...(since && { since }) });
  const output = formatThreads(filtered, totalCount, {
    title: prTitle,
    role,
    viewer,
  });

  console.log(output);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
