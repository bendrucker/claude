#!/usr/bin/env bun

import { $ } from "bun";
import { cli, command } from "cleye";
import {
  buildPosition,
  fetchMrDiffs,
  getDiffRefs,
  glabApiPost,
  readBody,
  validateLineInDiff,
} from "./diff";

function apiPath(mr: number): string {
  return `projects/:id/merge_requests/${mr}/draft_notes`;
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
        description: "Old line number (deleted lines)",
      },
      replyTo: {
        type: String,
        description: "Discussion ID to reply to",
      },
      resolve: {
        type: Boolean,
        description: "Resolve the discussion",
        default: false,
      },
      bodyFile: {
        type: String,
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
      const [refs, diffs] = await Promise.all([getDiffRefs(mr), fetchMrDiffs(mr)]);
      validateLineInDiff(diffs, parsed.flags.file, {
        line: parsed.flags.line,
        oldLine: parsed.flags.oldLine,
      });
      payload.position = buildPosition(refs, parsed.flags.file, {
        line: parsed.flags.line,
        oldLine: parsed.flags.oldLine,
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
        default: false,
        description: "Request changes after publishing (Premium+, GraphQL)",
      },
      summary: {
        type: String,
        description: "Review summary comment text",
      },
      summaryFile: {
        type: String,
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
      const query = `mutation($projectPath: ID!, $iid: String!) {
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

type ReviewEntry = {
  file?: string;
  line?: number;
  oldLine?: number;
  body: string;
};

const reviewCmd = command(
  {
    name: "review",
    parameters: ["<mr>"],
    flags: {
      input: {
        type: String,
        description: "JSON file with review entries",
      },
      submit: {
        type: Boolean,
        default: false,
        description: "Publish draft notes after creating",
      },
      approve: {
        type: Boolean,
        default: false,
        description: "Approve MR after publishing",
      },
    },
  },
  async (parsed) => {
    const mr = Number(parsed._.mr);

    if (!parsed.flags.input) {
      console.error("--input is required");
      process.exit(1);
    }

    const entries: ReviewEntry[] = JSON.parse(await Bun.file(parsed.flags.input).text());
    const hasPositioned = entries.some((e) => e.file);

    const [refs, diffs] = hasPositioned
      ? await Promise.all([getDiffRefs(mr), fetchMrDiffs(mr)])
      : [null, null];

    let created = 0;
    let failed = 0;

    for (const entry of entries) {
      try {
        const payload: Record<string, unknown> = { note: entry.body };

        if (entry.file && refs && diffs) {
          validateLineInDiff(diffs, entry.file, {
            line: entry.line,
            oldLine: entry.oldLine,
          });
          payload.position = buildPosition(refs, entry.file, {
            line: entry.line,
            oldLine: entry.oldLine,
          });
        }

        await glabApiPost(apiPath(mr), payload);
        created++;
      } catch (err) {
        console.error(
          `Failed: ${entry.file ?? "general"}: ${err instanceof Error ? err.message : String(err)}`,
        );
        failed++;
      }
    }

    console.error(`Created ${created} draft notes (${failed} failed)`);

    if (parsed.flags.submit) {
      await $`glab api ${apiPath(mr)}/bulk_publish -X POST`.text();
      console.error("Published draft notes");

      if (parsed.flags.approve) {
        const approveRefs = refs ?? (await getDiffRefs(mr));
        await $`glab api projects/:id/merge_requests/${mr}/approve -X POST -f sha=${approveRefs.head_sha}`.text();
        console.error("Approved MR");
      }
    }
  },
);

cli(
  {
    name: "draft-note",
    commands: [createCmd, publishCmd, submitCmd, listCmd, reviewCmd],
  },
  (parsed) => {
    parsed.showHelp();
  },
);
