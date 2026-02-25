#!/usr/bin/env bun

import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { cli, command } from "cleye";

function apiPath(mr: number): string {
  return `projects/:id/merge_requests/${mr}/draft_notes`;
}

async function readBody(file: string | undefined): Promise<string> {
  if (file === "-" || !file) {
    return await Bun.stdin.text();
  }
  return await Bun.file(file).text();
}

type DiffRefs = { base_sha: string; head_sha: string; start_sha: string };

async function getDiffRefs(mr: number): Promise<DiffRefs> {
  const result = await $`glab api projects/:id/merge_requests/${mr} | jq '.diff_refs'`.json();
  return result as DiffRefs;
}

type Position = {
  base_sha: string;
  head_sha: string;
  start_sha: string;
  old_path: string;
  new_path: string;
  position_type: "text";
  old_line?: number;
  new_line?: number;
  line_range?: {
    start: { new_line: number; type: "new" };
    end: { new_line: number; type: "new" };
  };
};

function buildPosition(
  refs: { base_sha: string; head_sha: string; start_sha: string },
  path: string,
  opts: {
    line?: number | undefined;
    oldLine?: number | undefined;
    lineStart?: number | undefined;
    lineEnd?: number | undefined;
  },
): Position {
  const position: Position = {
    ...refs,
    old_path: path,
    new_path: path,
    position_type: "text",
  };

  if (opts.lineStart !== undefined && opts.lineEnd !== undefined) {
    position.line_range = {
      start: { new_line: opts.lineStart, type: "new" },
      end: { new_line: opts.lineEnd, type: "new" },
    };
  } else if (opts.oldLine !== undefined) {
    position.old_line = opts.oldLine;
  } else if (opts.line !== undefined) {
    position.new_line = opts.line;
  }

  return position;
}

async function glabApiPost(path: string, payload: Record<string, unknown>): Promise<void> {
  const tmpFile = join(tmpdir(), `draft-note-${randomUUID()}.json`);
  await Bun.write(tmpFile, JSON.stringify(payload));
  try {
    const result =
      await $`glab api ${path} -X POST -H "Content-Type: application/json" --input ${tmpFile}`.text();
    console.log(result);
  } finally {
    await Bun.file(tmpFile).unlink();
  }
}

const createCmd = command(
  {
    name: "create",
    parameters: ["<mr>"],
    flags: {
      file: { type: String, description: "File path for inline comment" },
      line: { type: Number, description: "New line number" },
      oldLine: {
        type: Number,
        alias: "old-line",
        description: "Old line number (deleted lines)",
      },
      lineStart: {
        type: Number,
        alias: "line-start",
        description: "Multi-line range start",
      },
      lineEnd: {
        type: Number,
        alias: "line-end",
        description: "Multi-line range end",
      },
      replyTo: {
        type: String,
        alias: "reply-to",
        description: "Discussion ID to reply to",
      },
      resolve: {
        type: Boolean,
        description: "Resolve the discussion",
        default: false,
      },
      bodyFile: {
        type: String,
        alias: "body-file",
        description: "Read body from file (default: stdin)",
      },
    },
  },
  async (parsed) => {
    const mr = Number(parsed._.mr);
    const body = await readBody(parsed.flags.bodyFile);

    const payload: Record<string, unknown> = { note: body };

    if (parsed.flags.replyTo) {
      payload.in_reply_to_discussion_id = parsed.flags.replyTo;
      if (parsed.flags.resolve) {
        payload.resolve_discussion = true;
      }
    } else if (parsed.flags.file) {
      const refs = await getDiffRefs(mr);
      payload.position = buildPosition(refs, parsed.flags.file, {
        line: parsed.flags.line,
        oldLine: parsed.flags.oldLine,
        lineStart: parsed.flags.lineStart,
        lineEnd: parsed.flags.lineEnd,
      });
    }

    await glabApiPost(apiPath(mr), payload);
  },
);

const publishCmd = command(
  {
    name: "publish",
    parameters: ["<mr>"],
  },
  async (parsed) => {
    const mr = Number(parsed._.mr);
    const result = await $`glab api ${apiPath(mr)}/bulk_publish -X POST`.text();
    console.log(result);
  },
);

const submitCmd = command(
  {
    name: "submit",
    parameters: ["<mr>"],
    flags: {
      approve: {
        type: Boolean,
        default: false,
        description: "Approve the MR after publishing",
      },
      requestChanges: {
        type: Boolean,
        alias: "request-changes",
        default: false,
        description: "Request changes after publishing (Premium+, GraphQL)",
      },
      summary: {
        type: String,
        description: "Review summary comment text",
      },
      summaryFile: {
        type: String,
        alias: "summary-file",
        description: "Read review summary from file",
      },
    },
  },
  async (parsed) => {
    const mr = Number(parsed._.mr);

    if (parsed.flags.approve && parsed.flags.requestChanges) {
      console.error("Cannot both --approve and --request-changes");
      process.exit(1);
    }

    const summaryText = parsed.flags.summaryFile
      ? await Bun.file(parsed.flags.summaryFile).text()
      : parsed.flags.summary;

    const result = await $`glab api ${apiPath(mr)}/bulk_publish -X POST`.text();
    console.log(result);
    console.error("Published draft notes");

    if (summaryText) {
      const notePath = `projects/:id/merge_requests/${mr}/notes`;
      await glabApiPost(notePath, { body: summaryText });
      console.error("Posted summary comment");
    }

    if (parsed.flags.approve) {
      const refs = await getDiffRefs(mr);
      await $`glab api projects/:id/merge_requests/${mr}/approve -X POST -f sha=${refs.head_sha}`.text();
      console.error("Approved MR");
    } else if (parsed.flags.requestChanges) {
      const projectPath = (await $`glab repo view --output json | jq -r '.fullPath'`.text()).trim();
      const query = `mutation($projectPath: String!, $iid: String!) {
        mergeRequestRequestChanges(input: { projectPath: $projectPath, iid: $iid }) {
          mergeRequest { iid }
          errors
        }
      }`;
      const gqlResult =
        await $`glab api graphql -f query=${query} -F projectPath=${projectPath} -F iid=${String(mr)}`.json();
      const payload = gqlResult?.data?.mergeRequestRequestChanges;
      if (payload?.errors?.length) {
        console.error(`Request changes failed: ${payload.errors.join(", ")}`);
        process.exit(1);
      }
      console.error("Requested changes");
    }
  },
);

const listCmd = command(
  {
    name: "list",
    parameters: ["<mr>"],
  },
  async (parsed) => {
    const mr = Number(parsed._.mr);
    const result = await $`glab api ${apiPath(mr)}`.text();
    console.log(result);
  },
);

cli(
  {
    name: "draft-note",
    commands: [createCmd, publishCmd, submitCmd, listCmd],
  },
  (parsed) => {
    parsed.showHelp();
  },
);
