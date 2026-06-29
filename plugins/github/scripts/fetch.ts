#!/usr/bin/env bun

import {
  type PreToolUseHookInput,
  preToolUse,
  runHook,
  type SyncHookJSONOutput,
  type WebFetchInput,
} from "@bendrucker/claude-plugin-toolkit";
import UrlPattern from "url-pattern";

type RouteMatch = {
  type: string;
  params: Record<string, string>;
};

type Route = {
  pattern: UrlPattern;
  type: string;
  suggestion: (params: Record<string, string>) => string;
};

// Allow dots and other valid URL characters in segment values
const patternOptions = { segmentValueCharset: "a-zA-Z0-9-_.~%" };

const routes: Route[] = [
  {
    pattern: new UrlPattern("actions/runs/:runId/job/:jobId"),
    type: "job",
    suggestion: ({ jobId }) => `Use: gh run view --job ${jobId} --log.`,
  },
  {
    pattern: new UrlPattern("actions/runs/:runId"),
    type: "run",
    suggestion: ({ runId }) => `Use: gh run view ${runId}.`,
  },
  {
    pattern: new UrlPattern("issues/:number"),
    type: "issue",
    suggestion: ({ number }) => `Use: gh issue view ${number}.`,
  },
  {
    pattern: new UrlPattern("pull/:number"),
    type: "pr",
    suggestion: ({ number }) => `Use: gh pr view ${number}.`,
  },
  {
    pattern: new UrlPattern("blob/:ref/*"),
    type: "file",
    suggestion: () => `Use: gh api to fetch file contents.`,
  },
  {
    pattern: new UrlPattern("tree/:ref"),
    type: "file",
    suggestion: () => `Use: gh api to fetch file contents.`,
  },
  {
    pattern: new UrlPattern("tree/:ref/*"),
    type: "file",
    suggestion: () => `Use: gh api to fetch file contents.`,
  },
];

const repoBasePattern = new UrlPattern(":owner/:repo", patternOptions);
const repoPathPattern = new UrlPattern(":owner/:repo/*", patternOptions);

export function isGitHubUrl(url: string): boolean {
  return url.startsWith("https://github.com/");
}

export function matchRoute(path: string): RouteMatch | null {
  for (const route of routes) {
    const params = route.pattern.match(path);
    if (params) {
      return { type: route.type, params };
    }
  }
  return null;
}

export function parseGitHubUrl(url: string): { type: string; suggestion: string } | null {
  const path = url.slice("https://github.com/".length);

  const pathMatch = repoPathPattern.match(path);
  if (pathMatch) {
    const subpath = pathMatch._ || "";

    // Empty subpath means trailing slash on repo root
    if (subpath === "") {
      return {
        type: "repo",
        suggestion: `Use: gh repo view [<repository>].`,
      };
    }

    const routeMatch = matchRoute(subpath);
    if (routeMatch) {
      const route = routes.find((r) => r.type === routeMatch.type);
      if (route) {
        return {
          type: routeMatch.type,
          suggestion: route.suggestion(routeMatch.params),
        };
      }
    }
    return null;
  }

  const baseMatch = repoBasePattern.match(path);
  if (baseMatch) {
    return {
      type: "repo",
      suggestion: `Use: gh repo view [<repository>].`,
    };
  }

  return null;
}

export function isRawGitHubUrl(url: string): boolean {
  return url.startsWith("https://raw.githubusercontent.com/");
}

export function processInput(input: PreToolUseHookInput): SyncHookJSONOutput | null {
  const { url } = input.tool_input as WebFetchInput;

  if (isRawGitHubUrl(url)) {
    return preToolUse.deny(
      `Use: gh api repos/{owner}/{repo}/contents/{path}?ref={ref} to fetch raw file contents.`,
    );
  }

  if (!isGitHubUrl(url)) {
    return null;
  }

  const parsed = parseGitHubUrl(url);
  if (parsed) {
    return preToolUse.deny(parsed.suggestion);
  }

  return null;
}

if (import.meta.main) {
  runHook<PreToolUseHookInput, SyncHookJSONOutput>(processInput);
}
