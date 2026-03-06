import type { Integration } from "../integration";
import { resolveGitLabRepo } from "../repo";
import { run } from "../run";
import { formatLabels, section, sectionRaw, tag } from "../xml";

export type GitLabMrSource = {
  type: "gitlab-mr";
  project: string;
  iid: number;
  url: string;
};

export type GitLabIssueSource = {
  type: "gitlab-issue";
  project: string;
  iid: number;
  url: string;
};

export type GitLabMrContext = {
  type: "gitlab-mr";
  source: GitLabMrSource;
  metadata: Record<string, unknown>;
  diff: string;
};

export type GitLabIssueContext = {
  type: "gitlab-issue";
  source: GitLabIssueSource;
  metadata: Record<string, unknown>;
};

export const gitlabMr: Integration = {
  type: "gitlab-mr",
  mode: "review",

  parse(url: string) {
    const parsed = new URL(url);
    if (parsed.hostname !== "gitlab.com") return null;
    const match = parsed.pathname.match(/^\/(.+)\/-\/merge_requests\/(\d+)/);
    if (!match) return null;
    return {
      type: "gitlab-mr",
      project: match[1]!,
      iid: Number(match[2]),
      url,
    } satisfies GitLabMrSource;
  },

  async fetch(source) {
    const s = source as GitLabMrSource;
    const [metadataJson, diff] = await Promise.all([
      run(["glab", "mr", "view", String(s.iid), "-R", s.project, "-F", "json"]),
      run(["glab", "mr", "diff", String(s.iid), "-R", s.project]),
    ]);
    return {
      type: "gitlab-mr",
      source: s,
      metadata: JSON.parse(metadataJson) as Record<string, unknown>,
      diff,
    } satisfies GitLabMrContext;
  },

  format(context) {
    const ctx = context as GitLabMrContext;
    const m = ctx.metadata;
    const inner = [
      section("title", String(m.title ?? "")),
      section("description", String(m.description ?? "")),
      sectionRaw("diff", ctx.diff),
    ]
      .filter(Boolean)
      .join("\n");

    return tag(
      "pull-request",
      {
        source: "gitlab",
        iid: ctx.source.iid,
        url: ctx.source.url,
      },
      inner,
    );
  },

  async resolveRepo(context) {
    const ctx = context as GitLabMrContext;
    return resolveGitLabRepo(ctx.source.project);
  },
};

export const gitlabIssue: Integration = {
  type: "gitlab-issue",
  mode: "plan",

  parse(url: string) {
    const parsed = new URL(url);
    if (parsed.hostname !== "gitlab.com") return null;
    const match = parsed.pathname.match(/^\/(.+)\/-\/issues\/(\d+)/);
    if (!match) return null;
    return {
      type: "gitlab-issue",
      project: match[1]!,
      iid: Number(match[2]),
      url,
    } satisfies GitLabIssueSource;
  },

  async fetch(source) {
    const s = source as GitLabIssueSource;
    const metadataJson = await run([
      "glab",
      "issue",
      "view",
      String(s.iid),
      "-R",
      s.project,
      "-F",
      "json",
    ]);
    return {
      type: "gitlab-issue",
      source: s,
      metadata: JSON.parse(metadataJson) as Record<string, unknown>,
    } satisfies GitLabIssueContext;
  },

  format(context) {
    const ctx = context as GitLabIssueContext;
    const m = ctx.metadata;
    const inner = [
      section("title", String(m.title ?? "")),
      section("description", String(m.description ?? "")),
      formatLabels((m.labels as unknown[]) ?? []),
    ]
      .filter(Boolean)
      .join("\n");

    return tag(
      "task",
      {
        source: "gitlab",
        iid: ctx.source.iid,
        url: ctx.source.url,
      },
      inner,
    );
  },

  async resolveRepo(context) {
    const ctx = context as GitLabIssueContext;
    return resolveGitLabRepo(ctx.source.project);
  },
};
