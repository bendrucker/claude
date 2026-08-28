#!/usr/bin/env bun

import { cli } from "cleye";
import { z } from "zod";
import { Author, isBot, isReviewTarget, loadExtraReviewers } from "./reviewers";

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
          id
          isResolved
          isOutdated
          path
          line
          startLine
          comments(first: 50) {
            nodes {
              author { login __typename }
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

export const Comment = z.looseObject({
  author: Author.nullable(),
  body: z.string(),
  createdAt: z.string(),
});
export type Comment = z.infer<typeof Comment>;

export const Thread = z.looseObject({
  id: z.string(),
  isResolved: z.boolean(),
  isOutdated: z.boolean(),
  path: z.string(),
  line: z.number().nullable(),
  startLine: z.number().nullable(),
  comments: z.looseObject({ nodes: z.array(Comment) }),
});
export type Thread = z.infer<typeof Thread>;

export const Review = z.looseObject({
  author: z.looseObject({ login: z.string(), __typename: z.string() }).nullable(),
  submittedAt: z.string(),
  state: z.string(),
});
export type Review = z.infer<typeof Review>;

export const Role = z.enum(["author", "reviewer"]);
export type Role = z.infer<typeof Role>;

export function isBotThread(thread: Thread): boolean {
  return isBot(thread.comments.nodes[0]?.author);
}

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

  if (
    owner == null ||
    owner === "" ||
    repo == null ||
    repo === "" ||
    parts[2] !== "pull" ||
    Number.isNaN(number)
  ) {
    throw new Error(`Invalid PR URL: ${url}`);
  }

  return { owner, repo, number };
}

export function detectRole(viewer: string, prAuthor: string): Role {
  return viewer === prAuthor ? "author" : "reviewer";
}

/** An absent or empty --role falls back to detection. A non-empty invalid value returns null. */
export function resolveRole(
  roleFlag: string | undefined,
  viewer: string,
  prAuthor: string,
): Role | null {
  if (roleFlag == null || roleFlag === "") return detectRole(viewer, prAuthor);
  return Role.safeParse(roleFlag).data ?? null;
}

export function filterThreads(
  threads: Thread[],
  options: {
    role: Role;
    viewer: string;
    since?: Date | undefined;
    bots?: boolean | undefined;
    extra?: Set<string> | undefined;
    includeResolved?: boolean | undefined;
  },
): Thread[] {
  let filtered = options.includeResolved ? [...threads] : threads.filter((t) => !t.isResolved);

  if (options.bots) {
    // Review targets (API bots plus opted-in reviewers) open their own threads,
    // never the viewer's, so this replaces the reviewer-opener filter below.
    filtered = filtered.filter((t) => isReviewTarget(t.comments.nodes[0]?.author, options.extra));
  } else if (options.role === "reviewer") {
    // First comment is the thread opener
    filtered = filtered.filter((t) => t.comments.nodes[0]?.author?.login === options.viewer);
  }

  if (options.since) {
    const since = options.since;
    filtered = filtered.filter((t) => t.comments.nodes.some((c) => new Date(c.createdAt) >= since));
  }

  return filtered;
}

export function findLastReviewDate(reviews: Review[], viewer: string, role: Role): Date | null {
  const relevant =
    role === "author"
      ? reviews.filter((r) => r.author?.__typename === "User" && r.author.login !== viewer)
      : reviews.filter((r) => r.author?.login === viewer);

  const sorted = relevant.toSorted(
    (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime(),
  );

  const latest = sorted[0];
  return latest ? new Date(latest.submittedAt) : null;
}

export function formatThreads(
  threads: Thread[],
  totalCount: number,
  options: { title: string; role: Role; viewer: string; bots?: boolean; includeResolved?: boolean },
): string {
  const lines: string[] = [];
  lines.push(`# ${options.title}`);
  lines.push("");
  if (options.includeResolved) {
    const resolvedCount = threads.filter((t) => t.isResolved).length;
    lines.push(`${threads.length} of ${totalCount} total threads (${resolvedCount} resolved)`);
  } else {
    lines.push(`${threads.length} unresolved of ${totalCount} total threads`);
  }
  if (options.bots) {
    lines.push("Showing review-bot and opted-in reviewer threads");
  } else if (options.role === "reviewer") {
    lines.push(`Showing threads started by @${options.viewer}`);
  }
  lines.push("");

  if (threads.length === 0) {
    lines.push(options.includeResolved ? "No threads found." : "No unresolved threads found.");
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
      let lineInfo: string;
      if (thread.startLine != null) {
        lineInfo = `Lines ${thread.startLine}–${thread.line}`;
      } else if (thread.line != null) {
        lineInfo = `Line ${thread.line}`;
      } else {
        lineInfo = "File-level";
      }

      const outdated = thread.isOutdated ? " (outdated)" : "";
      const botTag = isBotThread(thread) ? " (bot)" : "";
      const resolvedTag = options.includeResolved && thread.isResolved ? " (resolved)" : "";
      lines.push(`### ${lineInfo}${outdated}${botTag}${resolvedTag}`);
      lines.push(`\`${thread.id}\``);
      lines.push("");

      for (const comment of thread.comments.nodes) {
        const author = comment.author?.login ?? "ghost";
        const date = comment.createdAt.split("T")[0];
        lines.push(`**@${author}** (${date}):`);
        const body = comment.body.trim();
        lines.push(
          body
            .split("\n")
            .map((l) => `> ${l}`)
            .join("\n"),
        );
        lines.push("");
      }

      lines.push("---");
      lines.push("");
    }
  }

  return lines.join("\n");
}

const GraphQLResponse = z.looseObject({
  data: z.looseObject({
    viewer: z.looseObject({ login: z.string() }),
    repository: z.looseObject({
      pullRequest: z.looseObject({
        title: z.string(),
        author: Author.nullable(),
        reviews: z.looseObject({ nodes: z.array(Review) }),
        reviewThreads: z.looseObject({
          totalCount: z.number(),
          pageInfo: z.looseObject({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
          nodes: z.array(Thread),
        }),
      }),
    }),
  }),
});

async function fetchGraphQL(
  query: string,
  variables: Record<string, string | number | undefined>,
): Promise<z.infer<typeof GraphQLResponse>> {
  const args = ["gh", "api", "graphql", "-f", `query=${query}`];
  for (const [key, value] of Object.entries(variables)) {
    if (value != null) {
      // -F sends typed values (numbers), -f sends strings
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

  try {
    return GraphQLResponse.parse(JSON.parse(stdout));
  } catch {
    throw new Error(`Failed to parse GraphQL response: ${stdout.slice(0, 200)}`);
  }
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
      bots: {
        type: Boolean,
        description: "Only review-bot threads (plus logins in $CLAUDE_PLUGIN_DATA/reviewers.txt)",
        default: false,
      },
      includeResolved: {
        type: Boolean,
        description: "Include resolved threads (excluded by default)",
        default: false,
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
    const variables: Record<string, string | number | undefined> = { owner, repo, number };
    if (cursor != null && cursor !== "") variables.cursor = cursor;

    const result = await fetchGraphQL(QUERY, variables);
    const pr = result.data.repository.pullRequest;

    if (prTitle === "") {
      viewer = result.data.viewer.login;
      prTitle = pr.title;
      prAuthor = pr.author?.login ?? "ghost";
      reviews = pr.reviews.nodes;
      totalCount = pr.reviewThreads.totalCount;
    }

    allThreads.push(...pr.reviewThreads.nodes);

    const pageInfo = pr.reviewThreads.pageInfo;
    cursor = pageInfo.hasNextPage ? (pageInfo.endCursor ?? undefined) : undefined;
  } while (cursor != null && cursor !== "");

  const role = resolveRole(argv.flags.role, viewer, prAuthor);
  if (role == null) {
    console.error(`Invalid --role: ${argv.flags.role} (must be "author" or "reviewer")`);
    process.exit(1);
  }

  let since: Date | undefined;
  if (argv.flags.since != null && argv.flags.since !== "") {
    if (argv.flags.since === "last-review") {
      const date = findLastReviewDate(reviews, viewer, role);
      if (!date) {
        console.error("No relevant reviews found");
        process.exit(1);
      }
      since = date;
    } else {
      since = new Date(argv.flags.since);
      if (Number.isNaN(since.getTime())) {
        console.error(`Invalid --since date: ${argv.flags.since}`);
        process.exit(1);
      }
    }
  }

  const filtered = filterThreads(allThreads, {
    role,
    viewer,
    since,
    bots: argv.flags.bots,
    extra: argv.flags.bots ? await loadExtraReviewers() : undefined,
    includeResolved: argv.flags.includeResolved,
  });
  const output = formatThreads(filtered, totalCount, {
    title: prTitle,
    role,
    viewer,
    bots: argv.flags.bots,
    includeResolved: argv.flags.includeResolved,
  });

  console.log(output);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
