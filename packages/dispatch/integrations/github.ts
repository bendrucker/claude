import UrlPattern from "url-pattern";
import type { Integration } from "../integration";
import { resolveGitHubRepo } from "../repo";
import { run } from "../run";
import { escapeXml, formatComments, formatLabels, section, sectionRaw, tag } from "../xml";

export type GitHubPrSource = {
  type: "github-pr";
  owner: string;
  repo: string;
  number: number;
  url: string;
};

export type GitHubIssueSource = {
  type: "github-issue";
  owner: string;
  repo: string;
  number: number;
  url: string;
};

export type GitHubPrContext = {
  type: "github-pr";
  source: GitHubPrSource;
  metadata: Record<string, unknown>;
  diff: string;
};

export type GitHubIssueContext = {
  type: "github-issue";
  source: GitHubIssueSource;
  metadata: Record<string, unknown>;
};

const prPattern = new UrlPattern("/:owner/:repo/pull/:number");
const issuePattern = new UrlPattern("/:owner/:repo/issues/:number");

function formatReviews(reviews: unknown[]): string {
  if (reviews.length === 0) return "";
  const formatted = reviews
    .map((r) => {
      const review = r as Record<string, unknown>;
      const author = (review.author as Record<string, unknown> | undefined)?.login ?? "unknown";
      const state = String(review.state ?? "");
      const body = String(review.body ?? "");
      if (!body)
        return `    <review author="${escapeXml(String(author))}" state="${escapeXml(state)}" />`;
      return `    <review author="${escapeXml(String(author))}" state="${escapeXml(state)}">${escapeXml(body)}</review>`;
    })
    .join("\n");
  return `  <review-comments>\n${formatted}\n  </review-comments>`;
}

export const githubPr: Integration = {
  type: "github-pr",
  mode: "review",

  parse(url: string) {
    const parsed = new URL(url);
    if (parsed.hostname !== "github.com") return null;
    const match = prPattern.match(parsed.pathname);
    if (!match) return null;
    return {
      type: "github-pr",
      owner: match.owner as string,
      repo: match.repo as string,
      number: Number(match.number),
      url,
    } satisfies GitHubPrSource;
  },

  async fetch(source) {
    const s = source as GitHubPrSource;
    const [metadataJson, diff] = await Promise.all([
      run([
        "gh",
        "pr",
        "view",
        s.url,
        "--json",
        "title,body,state,additions,deletions,changedFiles,reviews,comments,labels,headRefName,baseRefName",
      ]),
      run(["gh", "pr", "diff", s.url]),
    ]);
    return {
      type: "github-pr",
      source: s,
      metadata: JSON.parse(metadataJson) as Record<string, unknown>,
      diff,
    } satisfies GitHubPrContext;
  },

  format(context) {
    const ctx = context as GitHubPrContext;
    const m = ctx.metadata;
    const inner = [
      section("title", String(m.title ?? "")),
      section("description", String(m.body ?? "")),
      tag("stats", {
        additions: Number(m.additions ?? 0),
        deletions: Number(m.deletions ?? 0),
        files: Number(m.changedFiles ?? 0),
      }),
      formatReviews((m.reviews as unknown[]) ?? []),
      formatComments((m.comments as unknown[]) ?? []),
      sectionRaw("diff", ctx.diff),
    ]
      .filter(Boolean)
      .join("\n");

    return tag(
      "pull-request",
      {
        source: "github",
        number: ctx.source.number,
        url: ctx.source.url,
        head: String(m.headRefName ?? ""),
        base: String(m.baseRefName ?? ""),
      },
      inner,
    );
  },

  async resolveRepo(context) {
    const ctx = context as GitHubPrContext;
    return resolveGitHubRepo(ctx.source.owner, ctx.source.repo);
  },
};

export const githubIssue: Integration = {
  type: "github-issue",
  mode: "plan",

  parse(url: string) {
    const parsed = new URL(url);
    if (parsed.hostname !== "github.com") return null;
    const match = issuePattern.match(parsed.pathname);
    if (!match) return null;
    return {
      type: "github-issue",
      owner: match.owner as string,
      repo: match.repo as string,
      number: Number(match.number),
      url,
    } satisfies GitHubIssueSource;
  },

  async fetch(source) {
    const s = source as GitHubIssueSource;
    const metadataJson = await run([
      "gh",
      "issue",
      "view",
      s.url,
      "--json",
      "title,body,state,comments,labels,assignees",
    ]);
    return {
      type: "github-issue",
      source: s,
      metadata: JSON.parse(metadataJson) as Record<string, unknown>,
    } satisfies GitHubIssueContext;
  },

  format(context) {
    const ctx = context as GitHubIssueContext;
    const m = ctx.metadata;
    const inner = [
      section("title", String(m.title ?? "")),
      section("description", String(m.body ?? "")),
      formatLabels((m.labels as unknown[]) ?? []),
      formatComments((m.comments as unknown[]) ?? []),
    ]
      .filter(Boolean)
      .join("\n");

    return tag(
      "task",
      {
        source: "github",
        number: ctx.source.number,
        url: ctx.source.url,
      },
      inner,
    );
  },

  async resolveRepo(context) {
    const ctx = context as GitHubIssueContext;
    return resolveGitHubRepo(ctx.source.owner, ctx.source.repo);
  },
};
