#!/usr/bin/env bun

import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import UrlPattern from "url-pattern";
import { z } from "zod";

const WebFetchInput = z.looseObject({ url: z.string() });
export type WebFetchInput = z.infer<typeof WebFetchInput>;

export const HookInput = z.looseObject({ tool_input: z.unknown() });
export type HookInput = z.infer<typeof HookInput>;

// url-pattern's match() returns `any`.
const Params = z.record(z.string(), z.string());
const RepoPath = z.looseObject({ _: z.string().optional().catch(undefined) });

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
    const params = Params.safeParse(route.pattern.match(path));
    if (params.success) {
      return { type: route.type, params: params.data };
    }
  }
  return null;
}

export function parseGitHubUrl(url: string): { type: string; suggestion: string } | null {
  const path = url.slice("https://github.com/".length);

  const pathMatch = RepoPath.safeParse(repoPathPattern.match(path));
  if (pathMatch.success) {
    const subpath = pathMatch.data._ || "";

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

  const baseMatch = Params.safeParse(repoBasePattern.match(path));
  if (baseMatch.success) {
    return {
      type: "repo",
      suggestion: `Use: gh repo view [<repository>].`,
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

export function isRawGitHubUrl(url: string): boolean {
  return url.startsWith("https://raw.githubusercontent.com/");
}

export function processInput(input: HookInput): SyncHookJSONOutput | null {
  const { url } = WebFetchInput.parse(input.tool_input);

  if (isRawGitHubUrl(url)) {
    return formatOutput(
      "deny",
      `Use: gh api repos/{owner}/{repo}/contents/{path}?ref={ref} to fetch raw file contents.`,
    );
  }

  if (!isGitHubUrl(url)) {
    return null;
  }

  const parsed = parseGitHubUrl(url);
  if (parsed) {
    return formatOutput("deny", parsed.suggestion);
  }

  return null;
}

async function main(): Promise<void> {
  let input: HookInput;
  try {
    input = HookInput.parse(JSON.parse(await Bun.stdin.text()));
  } catch (error) {
    console.error(
      `[github/fetch] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const output = processInput(input);
  if (output) {
    process.stdout.write(`${JSON.stringify(output)}\n`);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
