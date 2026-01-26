#!/usr/bin/env bun

import type { PreToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";
import UrlPattern from "url-pattern";

export type WebFetchInput = { url: string; prompt: string };

type RouteMatch = {
  type: string;
  params: Record<string, string>;
};

type Route = {
  pattern: UrlPattern;
  type: string;
  suggestion: (params: Record<string, string>) => string;
};

const SUFFIX = "Run /github:gh for more patterns.";

// Allow dots and other valid URL characters in segment values
const patternOptions = { segmentValueCharset: "a-zA-Z0-9-_.~%" };

const routes: Route[] = [
  {
    pattern: new UrlPattern("actions/runs/:runId/job/:jobId"),
    type: "job",
    suggestion: ({ jobId }) => `Use: gh run view --job ${jobId} --log. ${SUFFIX}`,
  },
  {
    pattern: new UrlPattern("actions/runs/:runId"),
    type: "run",
    suggestion: ({ runId }) => `Use: gh run view ${runId}. ${SUFFIX}`,
  },
  {
    pattern: new UrlPattern("issues/:number"),
    type: "issue",
    suggestion: ({ number }) => `Use: gh issue view ${number}. ${SUFFIX}`,
  },
  {
    pattern: new UrlPattern("pull/:number"),
    type: "pr",
    suggestion: ({ number }) => `Use: gh pr view ${number}. ${SUFFIX}`,
  },
  {
    pattern: new UrlPattern("blob/:ref/*"),
    type: "file",
    suggestion: () => `Use: gh api to fetch file contents. ${SUFFIX}`,
  },
  {
    pattern: new UrlPattern("tree/:ref"),
    type: "file",
    suggestion: () => `Use: gh api to fetch file contents. ${SUFFIX}`,
  },
  {
    pattern: new UrlPattern("tree/:ref/*"),
    type: "file",
    suggestion: () => `Use: gh api to fetch file contents. ${SUFFIX}`,
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
  // Strip the GitHub prefix to simplify pattern matching
  const path = url.slice("https://github.com/".length);

  // Try pattern with additional path segments
  const pathMatch = repoPathPattern.match(path);
  if (pathMatch) {
    const subpath = pathMatch._ || "";

    // Empty subpath means trailing slash on repo root
    if (subpath === "") {
      return {
        type: "repo",
        suggestion: `Use: gh repo view [<repository>]. ${SUFFIX}`,
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

  // Try base pattern (repo root without trailing slash)
  const baseMatch = repoBasePattern.match(path);
  if (baseMatch) {
    return {
      type: "repo",
      suggestion: `Use: gh repo view [<repository>]. ${SUFFIX}`,
    };
  }

  return null;
}

export function formatOutput(
  decision: "allow" | "deny" | "ask",
  reason: string,
): SyncHookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
  };
}

export function processInput(input: PreToolUseHookInput): SyncHookJSONOutput | null {
  const { url } = input.tool_input as WebFetchInput;

  if (!isGitHubUrl(url)) {
    return null;
  }

  const parsed = parseGitHubUrl(url);
  if (parsed) {
    return formatOutput("deny", parsed.suggestion);
  }

  return formatOutput("ask", "Unknown GitHub URL pattern. Run /github:gh for guidance.");
}

async function main(): Promise<void> {
  let input: PreToolUseHookInput;
  try {
    input = await readStdinJson<PreToolUseHookInput>();
  } catch (error) {
    console.error(
      `[github/fetch] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const output = processInput(input);
  if (output) {
    writeStdoutJson(output);
  }
}

main().catch(console.error);
