#!/usr/bin/env bun

import type { PreToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import UrlPattern from "url-pattern";
import { isPreToolUse, isRecord, readHookInput } from "../hooks/hook-input";

export type HookInput = PreToolUseHookInput;

interface Project {
  host: string;
  path: string;
}

interface Route {
  pattern: UrlPattern;
  type: string;
  suggestion: (params: Record<string, string>, project: Project) => string;
}

interface RouteMatch {
  route: Route;
  params: Record<string, string>;
}

const GITLAB_COM = "gitlab.com";
const RESERVED_FIRST_SEGMENTS = new Set([
  "explore",
  "users",
  "dashboard",
  "groups",
  "help",
  "admin",
  "api",
  "-",
]);
const DIGITS = /^\d+$/;

function isParams(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

// A self-managed instance is `gitlab.<domain>`. Subdomains such as docs.gitlab.com are not projects.
function isGitLabHost(host: string): boolean {
  return host === GITLAB_COM || host.startsWith("gitlab.");
}

function repoFlag({ host, path }: Project): string {
  return host === GITLAB_COM ? `-R ${path}` : `-R https://${host}/${path}`;
}

function apiCall({ host, path }: Project, endpoint: string): string {
  const hostFlag = host === GITLAB_COM ? "" : `--hostname ${host} `;
  return `glab api ${hostFlag}"projects/${encodeURIComponent(path)}/${endpoint}"`;
}

const options = { segmentValueCharset: "a-zA-Z0-9-_.~%" };

const routes: Route[] = [
  {
    pattern: new UrlPattern("-/issues/:number(/*)", options),
    type: "issue",
    suggestion: ({ number }, project) => `Use: glab issue view ${number} ${repoFlag(project)}.`,
  },
  {
    pattern: new UrlPattern("-/work_items/:number(/*)", options),
    type: "issue",
    suggestion: ({ number }, project) => `Use: glab issue view ${number} ${repoFlag(project)}.`,
  },
  {
    pattern: new UrlPattern(/^-\/merge_requests\/(\d+)\.(?:diff|patch)$/, ["number"]),
    type: "mr",
    suggestion: ({ number }, project) => `Use: glab mr diff ${number} ${repoFlag(project)}.`,
  },
  {
    pattern: new UrlPattern("-/merge_requests/:number/diffs(/*)", options),
    type: "mr",
    suggestion: ({ number }, project) => `Use: glab mr diff ${number} ${repoFlag(project)}.`,
  },
  {
    pattern: new UrlPattern("-/merge_requests/:number/commits(/*)", options),
    type: "mr",
    suggestion: ({ number }, project) =>
      `Use: ${apiCall(project, `merge_requests/${number}/commits`)}.`,
  },
  {
    pattern: new UrlPattern("-/merge_requests/:number(/*)", options),
    type: "mr",
    suggestion: ({ number }, project) => `Use: glab mr view ${number} ${repoFlag(project)}.`,
  },
  {
    pattern: new UrlPattern("-/pipelines/:id(/*)", options),
    type: "pipeline",
    suggestion: ({ id }, project) => `Use: glab ci get -p ${id} ${repoFlag(project)} -F json.`,
  },
  {
    pattern: new UrlPattern("-/jobs/:id(/*)", options),
    type: "job",
    suggestion: ({ id }, project) => `Use: glab ci trace ${id} ${repoFlag(project)}.`,
  },
  {
    pattern: new UrlPattern("-/blob/:ref/*", options),
    type: "file",
    suggestion: ({ ref, _ }, project) => fileSuggestion(project, ref, _),
  },
  {
    pattern: new UrlPattern("-/raw/:ref/*", options),
    type: "file",
    suggestion: ({ ref, _ }, project) => fileSuggestion(project, ref, _),
  },
  {
    pattern: new UrlPattern("-/tree/:ref(/*)", options),
    type: "tree",
    suggestion: ({ ref, _ }, project) => {
      const path = _ == null ? "" : `&path=${encodeURIComponent(decodeURIComponent(_))}`;
      return `Use: ${apiCall(project, `repository/tree?ref=${ref}${path}`)}.`;
    },
  },
  {
    pattern: new UrlPattern("-/issues", options),
    type: "issues",
    suggestion: (_, project) => `Use: glab issue list ${repoFlag(project)}.`,
  },
  {
    pattern: new UrlPattern("-/merge_requests", options),
    type: "mrs",
    suggestion: (_, project) => `Use: glab mr list ${repoFlag(project)}.`,
  },
  {
    pattern: new UrlPattern("-/pipelines", options),
    type: "pipelines",
    suggestion: (_, project) => `Use: glab ci list ${repoFlag(project)}.`,
  },
];

function fileSuggestion(
  project: Project,
  ref: string | undefined,
  path: string | undefined,
): string {
  const file = encodeURIComponent(decodeURIComponent(path ?? ""));
  return `Use: ${apiCall(project, `repository/files/${file}/raw?ref=${ref ?? ""}`)}.`;
}

export function matchRoute(path: string): RouteMatch | null {
  for (const route of routes) {
    const params: unknown = route.pattern.match(path);
    if (!isParams(params)) continue;
    const ids = [params.number, params.id].filter((id) => id !== undefined);
    if (ids.every((id) => DIGITS.test(id))) return { route, params };
  }
  return null;
}

export function parseGitLabUrl(url: string): { type: string; suggestion: string } | null {
  const { host, pathname } = new URL(url);
  const path = decodeURIComponent(pathname).replaceAll(/^\/|\/$/g, "");
  const resourceIndex = path.indexOf("/-/");
  const projectPath = (resourceIndex === -1 ? path : path.slice(0, resourceIndex)).replace(
    /\.git$/,
    "",
  );
  const firstSegment = projectPath.split("/")[0] ?? "";
  if (!projectPath.includes("/") || RESERVED_FIRST_SEGMENTS.has(firstSegment)) return null;

  const project = { host, path: projectPath };
  if (resourceIndex === -1) {
    return { type: "repo", suggestion: `Use: glab repo view ${projectPath}.` };
  }

  const matched = matchRoute(pathname.slice(pathname.indexOf("/-/") + 1));
  if (!matched) return null;
  return {
    type: matched.route.type,
    suggestion: matched.route.suggestion(matched.params, project),
  };
}

export function formatOutput(decision: "deny" | "ask", reason: string): SyncHookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
  };
}

function fetchedUrl(input: HookInput): URL | null {
  if (!isRecord(input.tool_input) || typeof input.tool_input.url !== "string") return null;
  return URL.canParse(input.tool_input.url) ? new URL(input.tool_input.url) : null;
}

// hooks.json matches every WebFetch because the `domain:` form of `if` never fires, so the host is checked here.
export function processInput(input: HookInput): SyncHookJSONOutput | null {
  const url = fetchedUrl(input);
  if (url == null || !isGitLabHost(url.hostname)) return null;

  const parsed = parseGitLabUrl(url.href);
  if (parsed) return formatOutput("deny", parsed.suggestion);
  return formatOutput("ask", "Unknown GitLab URL pattern.");
}

async function main(): Promise<void> {
  const input = await readHookInput(isPreToolUse, "fetch");
  if (input == null) return;

  const output = processInput(input);
  if (output) {
    process.stdout.write(`${JSON.stringify(output)}\n`);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
