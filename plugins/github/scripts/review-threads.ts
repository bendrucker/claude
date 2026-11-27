#!/usr/bin/env bun

import { Command } from "@commander-js/extra-typings";
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
  if (body != null && body !== "") return body;
  if (file != null && file !== "") return (await Bun.file(file).text()).trim();
  return (await Bun.stdin.text()).trim();
}

const replyCmd = new Command("reply")
  .argument("<thread-id>")
  .option("--body <text>", "Reply text")
  .option("--body-file <path>", "Read reply from file (default: stdin)")
  .option("--resolve", "Resolve the thread after replying", false)
  .action(async (threadId, flags) => {
    const body = await readBody(flags.body, flags.bodyFile);
    if (body === "") {
      console.error("Reply body is empty");
      process.exit(1);
    }

    await ghGraphQL(z.unknown(), REPLY_MUTATION, { threadId, body });
    if (flags.resolve) {
      await ghGraphQL(z.unknown(), RESOLVE_MUTATION, { threadId });
    }
    console.error(`Replied to ${threadId}${flags.resolve ? " and resolved" : ""}`);
  });

const resolveCmd = new Command("resolve").argument("<thread-id>").action(async (threadId) => {
  await ghGraphQL(z.unknown(), RESOLVE_MUTATION, { threadId });
  console.error(`Resolved ${threadId}`);
});

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
  if (id == null || id === "") {
    throw new Error(`No comment found for thread ${threadId}`);
  }
  return id;
}

const reactCmd = new Command("react")
  .argument("<thread-id>")
  .option("--down", "React with thumbs down instead of thumbs up", false)
  .option("--resolve", "Resolve the thread after reacting", false)
  .action(async (threadId, flags) => {
    const content = flags.down ? "THUMBS_DOWN" : "THUMBS_UP";
    const subjectId = await firstCommentId(threadId);

    await ghGraphQL(z.unknown(), REACT_MUTATION, { subjectId, content });
    if (flags.resolve) {
      await ghGraphQL(z.unknown(), RESOLVE_MUTATION, { threadId });
    }
    console.error(
      `Reacted ${flags.down ? "👎" : "👍"} to ${threadId}${flags.resolve ? " and resolved" : ""}`,
    );
  });

export const program = new Command("review-threads")
  .addCommand(replyCmd)
  .addCommand(resolveCmd)
  .addCommand(reactCmd)
  .action(() => {
    program.help();
  });

if (import.meta.main) {
  await program.parseAsync();
}
