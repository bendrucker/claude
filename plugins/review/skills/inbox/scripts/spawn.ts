#!/usr/bin/env bun

import { cli } from "cleye";
import {
  buildDispatchArgs,
  PERMISSION_MODES,
  type PermissionMode,
  parseBackgroundedId,
} from "./args";
import { addDispatch, isDispatched, readState, writeState } from "./store";

const argv = cli({
  name: "spawn",
  parameters: ["<url>"],
  flags: {
    repoPath: {
      type: String,
      alias: "C",
      description:
        "Local clone of the PR's repo; the background session's working directory (the review agent runs `gh pr checkout` here)",
    },
    dataDir: {
      type: String,
      description: "Data directory for persistent state (defaults to CLAUDE_PLUGIN_DATA)",
    },
    permissionMode: {
      type: String,
      description: `Claude permission mode for the dispatched session (one of ${PERMISSION_MODES.join(", ")}); omit to keep Claude's default`,
    },
  },
});

const url = argv._.url;
const { repoPath, dataDir } = argv.flags;
const permissionModeFlag = argv.flags.permissionMode;

if (!repoPath) {
  console.error("--repo-path (-C) is required: local clone the review session runs in");
  process.exit(1);
}

if (
  permissionModeFlag !== undefined &&
  !(PERMISSION_MODES as readonly string[]).includes(permissionModeFlag)
) {
  console.error(`--permission-mode must be one of: ${PERMISSION_MODES.join(", ")}`);
  process.exit(1);
}

const permissionMode = permissionModeFlag as PermissionMode | undefined;

const state = await readState(dataDir);
if (isDispatched(state, url)) {
  console.error(`Already dispatched: ${url}`);
  process.exit(0);
}

// Launch the review as a background session, collected in `claude agents`. The
// harness moves the session into an isolated worktree on its first write (the
// review agent's `gh pr checkout`), so parallel reviews never share a working
// tree. Run from the repo clone so `gh` resolves the PR's repository.
const result = Bun.spawnSync(["claude", ...buildDispatchArgs({ url, permissionMode })], {
  cwd: repoPath,
  stdout: "pipe",
  stderr: "pipe",
});

if (result.exitCode !== 0) {
  const stderr = result.stderr.toString().trim();
  console.error(`Failed to launch background review: ${stderr}`);
  process.exit(1);
}

const sessionId = parseBackgroundedId(result.stdout.toString());
if (!sessionId) {
  console.error("Warning: launched but could not read the session id from claude output");
}

addDispatch(state, { url, sessionId, dispatchedAt: new Date().toISOString() });
try {
  await writeState(state, dataDir);
} catch (error) {
  // The session is already running but never got recorded. Stop it so the dedup
  // set and the live sessions stay consistent. Otherwise the next dispatch sees
  // an unrecorded URL and launches a duplicate review.
  if (sessionId) {
    Bun.spawnSync(["claude", "stop", sessionId], { stdout: "pipe", stderr: "pipe" });
  }
  throw error;
}

console.log(JSON.stringify({ sessionId, url, repoPath }, null, 2));
