#!/usr/bin/env bun

import { cli } from "cleye";
import { layoutArgs } from "./layout";
import { derivePaneName } from "./parse";
import { addReview, createReview, readState, writeState } from "./store";

const argv = cli({
  name: "spawn",
  parameters: ["<url>"],
  flags: {
    repoPath: {
      type: String,
      alias: "C",
      description: "Local path to the repository",
    },
    dataDir: {
      type: String,
      description: "Data directory for persistent state (defaults to CLAUDE_PLUGIN_DATA)",
    },
    context: {
      type: String,
      description: "Additional context to pass as the initial prompt to the spawned session",
    },
  },
});

const url = argv._.url;
const repoPath = argv.flags.repoPath;
const dataDir = argv.flags.dataDir;

if (!repoPath) {
  console.error("--repo-path (-C) is required: local path to the repository");
  process.exit(1);
}

const sessionId = crypto.randomUUID();
const paneName = derivePaneName(url);
const state = await readState(dataDir);
const activeReviews = state.reviews.filter((r) => r.status === "active");
const splitArgs = layoutArgs(activeReviews.length, activeReviews.at(-1)?.paneId);

const claudeArgs = [
  "claude",
  "--worktree",
  paneName,
  "--session-id",
  sessionId,
  "--name",
  paneName,
];

const prompt = argv.flags.context
  ? `${argv.flags.context}\n\n/review:peer ${url}`
  : `/review:peer ${url}`;

claudeArgs.push(prompt);

const claudeCmd = claudeArgs.map((arg) => Bun.$.escape(arg)).join(" ");

const result = Bun.spawnSync(
  ["tmux", "split-window", ...splitArgs, "-c", repoPath, "-P", "-F", "#{pane_id}", claudeCmd],
  { stdout: "pipe", stderr: "pipe" },
);

if (result.exitCode !== 0) {
  const stderr = result.stderr.toString().trim();
  console.error(`Failed to create tmux pane: ${stderr}`);
  process.exit(1);
}

const paneId = result.stdout.toString().trim();

const review = createReview({ url, title: null, sessionId, paneId, repoPath });
try {
  addReview(state, review);
  await writeState(state, dataDir);
} catch (error) {
  Bun.spawnSync(["tmux", "kill-pane", "-t", paneId]);
  throw error;
}

console.log(JSON.stringify({ sessionId, paneId, paneName, url, repoPath }, null, 2));
