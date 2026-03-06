import type { Integration } from "./integration";
import { githubIssue, githubPr } from "./integrations/github";
import { gitlabIssue, gitlabMr } from "./integrations/gitlab";
import { linear } from "./integrations/linear";
import { things } from "./integrations/things";

export type {
  GitHubIssueContext,
  GitHubIssueSource,
  GitHubPrContext,
  GitHubPrSource,
} from "./integrations/github";
export type {
  GitLabIssueContext,
  GitLabIssueSource,
  GitLabMrContext,
  GitLabMrSource,
} from "./integrations/gitlab";
export type { LinearContext, LinearSource } from "./integrations/linear";
export type { ThingsContext, ThingsSource } from "./integrations/things";

export type Source =
  | import("./integrations/github").GitHubPrSource
  | import("./integrations/github").GitHubIssueSource
  | import("./integrations/gitlab").GitLabMrSource
  | import("./integrations/gitlab").GitLabIssueSource
  | import("./integrations/linear").LinearSource
  | import("./integrations/things").ThingsSource;

export type FetchedContext =
  | import("./integrations/github").GitHubPrContext
  | import("./integrations/github").GitHubIssueContext
  | import("./integrations/gitlab").GitLabMrContext
  | import("./integrations/gitlab").GitLabIssueContext
  | import("./integrations/linear").LinearContext
  | import("./integrations/things").ThingsContext;

export const integrations: Integration[] = [
  githubPr,
  githubIssue,
  gitlabMr,
  gitlabIssue,
  linear,
  things,
];

function find(type: string): Integration {
  const integration = integrations.find((i) => i.type === type);
  if (!integration) throw new Error(`No integration for type: ${type}`);
  return integration;
}

export function parseUrl(url: string): Source {
  for (const integration of integrations) {
    const source = integration.parse(url);
    if (source) return source as Source;
  }
  throw new Error(`Unsupported URL: ${url}`);
}

export function fetchContext(source: Source): Promise<FetchedContext> {
  return find(source.type).fetch(source) as Promise<FetchedContext>;
}
