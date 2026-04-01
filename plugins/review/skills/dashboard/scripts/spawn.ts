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
  },
});

const url = argv._.url;
const repoPath = argv.flags.repoPath;

if (!repoPath) {
  console.error("--repo-path (-C) is required: local path to the repository");
  process.exit(1);
}

const sessionId = crypto.randomUUID();
const paneName = derivePaneName(url);
const state = await readState();
const activeReviews = state.reviews.filter((r) => r.status === "active");
const splitArgs = layoutArgs(activeReviews.length, activeReviews.at(-1)?.paneId);

const claudeCmd = [
  "claude",
  "--worktree",
  "--session-id",
  sessionId,
  "--name",
  paneName,
  `/review:peer ${url}`,
]
  .map((arg) => Bun.$.escape(arg))
  .join(" ");

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
addReview(state, review);
await writeState(state);

console.log(JSON.stringify({ sessionId, paneId, paneName, url, repoPath }, null, 2));
