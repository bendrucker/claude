import { rm } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";
import { z } from "zod";
import { decodeFile, decodeJson } from "../../../../packages/decode/index";
import { errorCode, paneAgent } from "./herdr";

const EXIT_POLL_MS = 500;
const EXIT_TIMEOUT_MS = 30_000;
const START_TIMEOUT_MS = 60_000;
const TRUST_DIALOG = /trust (this|the files in this) folder/i;
const TRUST_CURSOR = /❯\s+Yes/;
const TRUST_OPTIONS = 5;

const WorktreeCreated = z.object({
  result: z.object({
    workspace: z.object({ workspace_id: z.string() }),
    root_pane: z.object({ pane_id: z.string() }),
    worktree: z.object({ path: z.string() }),
  }),
});

const Trial = z.object({
  root: z.string(),
  path: z.string(),
  branch: z.string(),
  base: z.string(),
  pane: z.string(),
  workspace: z.string(),
});

type Trial = z.output<typeof Trial>;

export interface TrialOptions {
  name: string;
  stateDir: string;
  cwd: string;
  base: string;
  prompt: string;
  load: string[];
}

function trialPath(stateDir: string, name: string): string {
  return join(stateDir, `trial-${name}.json`);
}

async function readTrial(stateDir: string, name: string): Promise<Trial | undefined> {
  const path = trialPath(stateDir, name);
  return (await Bun.file(path).exists()) ? decodeFile(Trial, path) : undefined;
}

// herdr refuses a linked worktree as the source of a new one, and the watched session often runs in one.
async function mainCheckout(cwd: string): Promise<string> {
  const listing = await $`git -C ${cwd} worktree list --porcelain`.text();
  const root = listing
    .split("\n")
    .find((line) => line.startsWith("worktree "))
    ?.slice("worktree ".length);
  if (root === undefined) throw new Error(`git lists no worktree for ${cwd}`);
  return root;
}

async function createTrial(options: TrialOptions): Promise<Trial> {
  const root = await mainCheckout(options.cwd);
  const branch = `watch-trial-${options.name}`;
  const text =
    await $`herdr worktree create --cwd ${root} --branch ${branch} --base ${options.base} --label trial-${options.name} --no-focus`.text();
  const created = decodeJson(WorktreeCreated, text, "herdr worktree create").result;
  const trial: Trial = {
    root,
    path: created.worktree.path,
    branch,
    base: options.base,
    pane: created.root_pane.pane_id,
    workspace: created.workspace.workspace_id,
  };
  await Bun.write(trialPath(options.stateDir, options.name), `${JSON.stringify(trial, null, 2)}\n`);
  return trial;
}

async function awaitExit(pane: string, deadline: number): Promise<void> {
  if ((await paneAgent(pane)) === undefined) return;
  if (Date.now() > deadline) throw new Error(`the agent in ${pane} did not exit after /exit`);
  await Bun.sleep(EXIT_POLL_MS);
  return awaitExit(pane, deadline);
}

async function exitAgent(pane: string): Promise<void> {
  if ((await paneAgent(pane)) === undefined) return;
  await $`herdr agent prompt ${pane} /exit`.quiet();
  await awaitExit(pane, Date.now() + EXIT_TIMEOUT_MS);
}

// Trial output lands in ignored paths like tmp/, which -x removes to match the first trial's fresh checkout.
async function resetTrial(trial: Trial): Promise<void> {
  await exitAgent(trial.pane);
  await $`git -C ${trial.path} reset --hard ${trial.base}`.quiet();
  await $`git -C ${trial.path} clean -fdx`.quiet();
}

function readScreen(pane: string): Promise<string> {
  return $`herdr pane read ${pane} --source visible --lines 30`.text();
}

// The dialog's cursor starts on "No, exit", so move it to the "Yes" option before confirming.
async function acceptTrust(pane: string, moves: number): Promise<void> {
  if (TRUST_CURSOR.test(await readScreen(pane))) {
    await $`herdr agent send-keys ${pane} enter`.quiet();
    return;
  }
  if (moves === 0) throw new Error(`no "Yes" option in the trust dialog in ${pane}`);
  await $`herdr agent send-keys ${pane} down`.quiet();
  return acceptTrust(pane, moves - 1);
}

async function startAgent(trial: Trial, name: string, load: string[]): Promise<void> {
  const started =
    await $`herdr agent start trial-${name} --kind claude --pane ${trial.pane} -- ${load}`
      .quiet()
      .nothrow();
  if (started.exitCode === 0) return;
  const stderr = started.stderr.toString();
  if (errorCode(stderr) !== "agent_not_ready") throw new Error(stderr);
  // A new worktree draws Claude Code's trust dialog, which only a keypress answers.
  const screen = await readScreen(trial.pane);
  if (!TRUST_DIALOG.test(screen))
    throw new Error(`the trial agent is held by a dialog:\n${screen}`);
  await acceptTrust(trial.pane, TRUST_OPTIONS);
  await $`herdr agent wait ${trial.pane} --until idle --until done --timeout ${START_TIMEOUT_MS}`.quiet();
}

/** Starts a fresh trial session with the skill loaded and sends it the prompt, creating the worktree on first use. */
export async function startTrial(options: TrialOptions): Promise<Trial & { session?: string }> {
  const existing = await readTrial(options.stateDir, options.name);
  const trial = existing ?? (await createTrial(options));
  if (existing) await resetTrial(existing);
  await startAgent(trial, options.name, options.load);
  await $`herdr agent prompt ${trial.pane} ${options.prompt}`.quiet();
  const session = (await paneAgent(trial.pane))?.session;
  return session === undefined ? trial : { ...trial, session };
}

/** Exits the trial session, removes its worktree and branch, and forgets it. */
export async function endTrial(stateDir: string, name: string): Promise<Trial> {
  const trial = await readTrial(stateDir, name);
  if (trial === undefined) throw new Error(`no trial named ${name} in ${stateDir}`);
  await exitAgent(trial.pane);
  await $`herdr worktree remove --workspace ${trial.workspace} --force`.quiet();
  await $`git -C ${trial.root} branch -D ${trial.branch}`.quiet();
  await rm(trialPath(stateDir, name));
  return trial;
}
