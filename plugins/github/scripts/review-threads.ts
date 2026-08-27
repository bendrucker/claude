#!/usr/bin/env bun

import { cli, command } from "cleye";
import { z } from "zod";

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

export const THREAD_COMMENT_QUERY = `
query($threadId: ID!) {
  node(id: $threadId) {
    ... on PullRequestReviewThread {
      comments(first: 1) { nodes { id } }
    }
  }
}
`;

export const REACT_MUTATION = `
mutation($subjectId: ID!, $content: ReactionContent!) {
  addReaction(input: { subjectId: $subjectId, content: $content }) {
    reaction { content }
  }
}
`;

async function ghGraphQL<S extends z.ZodType>(
  schema: S,
  query: string,
  variables: Record<string, string>,
): Promise<z.output<S>> {
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
    return schema.parse(JSON.parse(stdout));
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

    await ghGraphQL(z.unknown(), REPLY_MUTATION, { threadId, body });
    if (parsed.flags.resolve) {
      await ghGraphQL(z.unknown(), RESOLVE_MUTATION, { threadId });
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
    await ghGraphQL(z.unknown(), RESOLVE_MUTATION, { threadId: parsed._.threadId });
    console.error(`Resolved ${parsed._.threadId}`);
  },
);

const ThreadCommentResponse = z.looseObject({
  data: z.looseObject({
    node: z
      .looseObject({
        comments: z.looseObject({ nodes: z.array(z.looseObject({ id: z.string() })) }),
      })
      .nullable(),
  }),
});

async function firstCommentId(threadId: string): Promise<string> {
  const result = await ghGraphQL(ThreadCommentResponse, THREAD_COMMENT_QUERY, { threadId });
  const id = result.data.node?.comments.nodes[0]?.id;
  if (!id) {
    throw new Error(`No comment found for thread ${threadId}`);
  }
  return id;
}

const reactCmd = command(
  {
    name: "react",
    parameters: ["<thread-id>"],
    flags: {
      down: {
        type: Boolean,
        description: "React with thumbs down instead of thumbs up",
        default: false,
      },
      resolve: {
        type: Boolean,
        description: "Resolve the thread after reacting",
        default: false,
      },
    },
  },
  async (parsed) => {
    const threadId = parsed._.threadId;
    const content = parsed.flags.down ? "THUMBS_DOWN" : "THUMBS_UP";
    const subjectId = await firstCommentId(threadId);

    await ghGraphQL(z.unknown(), REACT_MUTATION, { subjectId, content });
    if (parsed.flags.resolve) {
      await ghGraphQL(z.unknown(), RESOLVE_MUTATION, { threadId });
    }
    console.error(
      `Reacted ${parsed.flags.down ? "👎" : "👍"} to ${threadId}${parsed.flags.resolve ? " and resolved" : ""}`,
    );
  },
);

if (import.meta.main) {
  cli(
    {
      name: "review-threads",
      commands: [replyCmd, resolveCmd, reactCmd],
    },
    (parsed) => {
      parsed.showHelp();
    },
  );
}
