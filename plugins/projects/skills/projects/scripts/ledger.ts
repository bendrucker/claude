#!/usr/bin/env bun
// claude:dangerouslyDisableSandbox: appends the dispatch ledger in the plugin data dir under ~/.claude/plugins
import { cli, command } from "cleye";
import { z } from "zod";
import { listAgents, primaryRoot, readPullRequests } from "./capture";
import { openItems, pushItem, readQueue, resolveLanded } from "./items";
import { readProjects } from "./projects";
import { buildStatus, formatStatus } from "./status";
import {
  appendOutcome,
  CLOSING,
  latestRows,
  MAX_NOTE,
  MAX_TAG_VALUE,
  parseTags,
  readLedger,
  resolveDataDir,
} from "./threads";

const dataDir = {
  type: String,
  description: "Ledger directory; defaults to the plugin data dir",
};

const outcome = command(
  {
    name: "outcome",
    help: { description: "Record a thread's outcome as a new ledger row." },
    flags: {
      repo: {
        type: String,
        default: process.cwd(),
        description: "Repository the thread was dispatched from, or any worktree of it",
      },
      branch: { type: String, description: "Branch the thread works on (required)" },
      state: { type: String, description: `One of ${CLOSING.join(", ")} (required)` },
      pr: { type: String, description: "Pull request URL" },
      note: {
        type: String,
        description: `Why, when the state is blocked or abandoned (at most ${MAX_NOTE} characters)`,
      },
      dataDir,
    },
  },
  async (argv) => {
    const state = z.enum(CLOSING).safeParse(argv.flags.state);
    if (argv.flags.branch == null || argv.flags.branch === "" || !state.success) {
      process.stderr.write(`--branch and --state (${CLOSING.join(", ")}) are required\n`);
      argv.showHelp();
      process.exit(2);
    }
    const dir = resolveDataDir(argv.flags.dataDir);
    try {
      const row = await appendOutcome(
        {
          repo: await primaryRoot(argv.flags.repo),
          branch: argv.flags.branch,
          state: state.data,
          pr: argv.flags.pr,
          note: argv.flags.note,
        },
        dir,
      );
      process.stdout.write(`${JSON.stringify(row)}\n`);
      // A finished thread behind a pull request is a review Ben owes, so the
      // one command the lead already runs raises it. The queue item prints as
      // a second line.
      if (row.outcome === "done" && row.pr != null)
        process.stdout.write(
          `${JSON.stringify(
            pushItem(
              {
                kind: "review",
                text: row.task,
                url: row.pr,
                thread: { repo: row.repo, branch: row.branch },
                agent: row.agent ?? undefined,
                pane: row.pane,
              },
              dir,
            ),
          )}\n`,
        );
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    }
  },
);

const status = command(
  {
    name: "status",
    help: { description: "Print the projects and the open threads, optionally filtered by tag." },
    flags: {
      tag: {
        type: [String],
        description: `Only threads carrying this key=value; repeatable (value at most ${MAX_TAG_VALUE} characters)`,
      },
      json: { type: Boolean, description: "Print the status as JSON" },
      dataDir,
    },
  },
  async (argv) => {
    let tags: Record<string, string>;
    try {
      tags = parseTags(argv.flags.tag);
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(2);
    }
    const dir = resolveDataDir(argv.flags.dataDir);
    const now = new Date();
    const [projects, rows] = await Promise.all([readProjects(dir), readLedger(dir)]);
    const [agents, pullRequests, queue] = await Promise.all([
      listAgents(),
      readPullRequests(latestRows(rows), now),
      resolveLanded(openItems(readQueue(dir)), dir),
    ]);
    const built = buildStatus(projects, rows, tags, { agents, pullRequests, now }, queue);
    process.stdout.write(argv.flags.json ? `${JSON.stringify(built)}\n` : formatStatus(built, now));
  },
);

await cli(
  {
    name: "ledger",
    help: { description: "Read and extend the dispatch ledger." },
    commands: [outcome, status],
  },
  (argv) => {
    argv.showHelp();
    process.exit(2);
  },
);
