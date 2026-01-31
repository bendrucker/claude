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

const SUFFIX = "Run /gitlab:glab for more patterns.";

// GitLab uses /-/ prefix for resource paths
const routes: Route[] = [
  {
    pattern: new UrlPattern("-/issues/:number"),
    type: "issue",
    suggestion: ({ number }) => `Use: glab issue view ${number}. ${SUFFIX}`,
  },
  {
    pattern: new UrlPattern("-/merge_requests/:number"),
    type: "mr",
    suggestion: ({ number }) => `Use: glab mr view ${number}. ${SUFFIX}`,
  },
  {
    pattern: new UrlPattern("-/pipelines/:id"),
    type: "pipeline",
    suggestion: ({ id }) => `Use: glab ci view ${id}. ${SUFFIX}`,
  },
  {
    pattern: new UrlPattern("-/jobs/:id"),
    type: "job",
    suggestion: ({ id }) => `Use: glab ci trace ${id}. ${SUFFIX}`,
  },
  {
    pattern: new UrlPattern("-/blob/:ref/*"),
    type: "file",
    suggestion: () => `Use: glab api to fetch file contents. ${SUFFIX}`,
  },
  {
    pattern: new UrlPattern("-/tree/:ref"),
    type: "tree",
    suggestion: () => `Use: glab api to fetch file contents. ${SUFFIX}`,
  },
  {
    pattern: new UrlPattern("-/tree/:ref/*"),
    type: "tree",
    suggestion: () => `Use: glab api to fetch file contents. ${SUFFIX}`,
  },
];

export function isGitLabUrl(url: string): boolean {
  return url.startsWith("https://gitlab.com/");
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

export function parseGitLabUrl(url: string): { type: string; suggestion: string } | null {
  const path = url.slice("https://gitlab.com/".length);

  // Check if this contains a /-/ path separator (resource path)
  const resourceIndex = path.indexOf("/-/");
  if (resourceIndex !== -1) {
    const resourcePath = path.slice(resourceIndex + 1); // Include the "-/"
    const routeMatch = matchRoute(resourcePath);
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

  // No /-/ means this is a project root (possibly with nested groups)
  // Match: group/project or group/subgroup/project etc.
  // Must have at least one slash and no special characters that indicate other pages
  const pathWithoutSlash = path.replace(/\/$/, "");
  if (pathWithoutSlash.includes("/") && !pathWithoutSlash.includes("?")) {
    return {
      type: "repo",
      suggestion: `Use: glab repo view [<project>]. ${SUFFIX}`,
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

  if (!isGitLabUrl(url)) {
    return null;
  }

  const parsed = parseGitLabUrl(url);
  if (parsed) {
    return formatOutput("deny", parsed.suggestion);
  }

  return formatOutput("ask", `Unknown GitLab URL pattern. ${SUFFIX}`);
}

async function main(): Promise<void> {
  let input: PreToolUseHookInput;
  try {
    input = await readStdinJson<PreToolUseHookInput>();
  } catch (error) {
    console.error(
      `[gitlab/fetch] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const output = processInput(input);
  if (output) {
    writeStdoutJson(output);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
