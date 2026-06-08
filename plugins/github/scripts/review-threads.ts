#!/usr/bin/env bun
// claude:dangerouslyDisableSandbox: shells out to gh (Go binary) for TLS-bearing API calls

import { cli, command } from "cleye";

export const REPLY_MUTATION = `
mutation($threadId: ID!, $body: String!) {
  addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $threadId, body: $body }) {
    comment { id url }
  }
}
`;

export const RESOLVE_MUTATION = `
mutation($threadId: ID!) {
  resolveReviewThread(input: { threadId: $threadId }) {
    thread { id isResolved }
  }
}
`;

async function ghGraphQL(query: string, variables: Record<string, string>): Promise<unknown> {
  const args = ["gh", "api", "graphql", "-f", `query=${query}`];
  for (const [key, value] of Object.entries(variables)) {
    args.push("-f", `${key}=${value}`);
  }

  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`gh api graphql failed: ${stderr}`);
  }

  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`Failed to parse GraphQL response: ${stdout.slice(0, 200)}`);
  }
}

async function readBody(body?: string, file?: string): Promise<string> {
  if (body) return body;
  if (file) return (await Bun.file(file).text()).trim();
  return (await Bun.stdin.text()).trim();
}

const replyCmd = command(
  {
    name: "reply",
    parameters: ["<thread-id>"],
    flags: {
      body: { type: String, description: "Reply text" },
      bodyFile: { type: String, description: "Read reply from file (default: stdin)" },
      resolve: {
        type: Boolean,
        description: "Resolve the thread after replying",
        default: false,
      },
    },
  },
  async (parsed) => {
    const threadId = parsed._.threadId;
    const body = await readBody(parsed.flags.body, parsed.flags.bodyFile);
    if (!body) {
      console.error("Reply body is empty");
      process.exit(1);
    }

    await ghGraphQL(REPLY_MUTATION, { threadId, body });
    if (parsed.flags.resolve) {
      await ghGraphQL(RESOLVE_MUTATION, { threadId });
    }
    console.error(`Replied to ${threadId}${parsed.flags.resolve ? " and resolved" : ""}`);
  },
);

const resolveCmd = command(
  {
    name: "resolve",
    parameters: ["<thread-id>"],
  },
  async (parsed) => {
    await ghGraphQL(RESOLVE_MUTATION, { threadId: parsed._.threadId });
    console.error(`Resolved ${parsed._.threadId}`);
  },
);

if (import.meta.main) {
  cli(
    {
      name: "review-threads",
      commands: [replyCmd, resolveCmd],
    },
    (parsed) => {
      parsed.showHelp();
    },
  );
}
