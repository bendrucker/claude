import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { BARE_COMMAND } from "./launch";
import { type Checkout, DispatchError, type DispatchRecord, type WorktreeOptions } from "./record";
import type { ResolveRepo } from "./repo";
import { required, requiredJson } from "./required";
import {
  type CommandResult,
  type Pause,
  type Runner,
  type RunOptions,
  spawnRunner,
} from "./runner";
import { mergeSettings, parseSettings, type Settings, settingsKeys } from "./settings";

// wt's pr:<n> and mr:<n> shortcuts, or a PR or MR URL.
export const CHANGE_PATTERN =
  /^(?:(?:pr|mr):[1-9][0-9]*|https:\/\/[A-Za-z0-9.-]+(?:\/[A-Za-z0-9._~%-]+)+)$/;
const FETCH_TIMEOUT_MS = 60_000;
const LOCK_PAUSE_MS = 250;
// A denied write shares the prefix, but only a lock someone holds exists already.
const CONFIG_LOCK_HELD = /could not lock config file .*: File exists/;
const SETTINGS_FILE = ".claude/settings.local.json";

const WtSwitched = z.object({
  action: z.string(),
  branch: z.string().nullish(),
  path: z.string(),
  created_branch: z.boolean().optional(),
});

// A base like origin/main needs its remote updated first. A local ref names no
// remote, and fetching one the repository does not have would fail the dispatch.
function baseRemote(remotes: ReadonlySet<string>, base: string): string | null {
  const candidate = base.split("/")[0];
  if (candidate == null || candidate === base) return null;
  return remotes.has(candidate) ? candidate : null;
}

function failureText(result: CommandResult, label: string): string {
  const stderr = result.stderr.trim();
  return stderr === "" ? `${label} exited ${result.code}` : stderr;
}

// Every worktree of a repository writes the one .git/config, and git fails at
// once rather than waiting when a sibling holds its lock.
function retryConfigLock(run: Runner, budgetMs: number, pause: Pause): Runner {
  const attempt = async (
    argv: readonly string[],
    options: RunOptions | undefined,
    waited: number,
  ): Promise<CommandResult> => {
    const result = await run(argv, options);
    if (result.code === 0 || !CONFIG_LOCK_HELD.test(result.stderr) || waited >= budgetMs)
      return result;
    await pause(LOCK_PAUSE_MS);
    return attempt(argv, options, waited + LOCK_PAUSE_MS);
  };
  return (argv, options) => attempt(argv, options, 0);
}

// GitHub over SSH signs with a key that may need a touch nobody is there to give, so
// fetch the same repository over HTTPS into the remote's own tracking refs.
export function fetchArgs(remote: string, url: string): string[] {
  const ssh = /^(?:git@github\.com:|ssh:\/\/git@github\.com\/)(.+?)(?:\.git)?\/?$/.exec(url.trim());
  if (ssh?.[1] == null) return [remote];
  return [`https://github.com/${ssh[1]}.git`, `+refs/heads/*:refs/remotes/${remote}/*`];
}

// git worktree add leaves submodules empty, so a checkout whose tooling links
// into them comes up broken. The session can still repair it, so a failure is
// recorded rather than fatal.
async function initSubmodules(run: Runner, path: string): Promise<string | undefined> {
  if (!(await Bun.file(join(path, ".gitmodules")).exists())) return undefined;
  const result = await run(["git", "-C", path, "submodule", "update", "--init", "--recursive"], {
    timeoutMs: FETCH_TIMEOUT_MS,
    env: { GIT_TERMINAL_PROMPT: "0" },
  });
  return result.code === 0 ? undefined : failureText(result, "git submodule update");
}

// A tracked settings file would put the grants in the session's next commit.
async function writeSettings(
  run: Runner,
  path: string,
  patch: Settings,
  partial: DispatchRecord,
): Promise<string[]> {
  const keys = settingsKeys(patch);
  if (keys.length === 0) return [];
  const ignored = await run(["git", "-C", path, "check-ignore", "--quiet", SETTINGS_FILE]);
  if (ignored.code === 1)
    throw new DispatchError(
      `${SETTINGS_FILE} is not git-ignored in ${path}, so the settings were not written`,
      partial,
    );
  if (ignored.code !== 0)
    throw new DispatchError(failureText(ignored, "git check-ignore"), partial);

  const file = Bun.file(join(path, SETTINGS_FILE));
  let existing: Settings = {};
  if (await file.exists()) {
    try {
      existing = parseSettings(await file.text(), join(path, SETTINGS_FILE));
    } catch (error) {
      throw new DispatchError(error instanceof Error ? error.message : String(error), partial);
    }
  }
  await Bun.write(file, `${JSON.stringify(mergeSettings(existing, patch), null, 2)}\n`);
  return keys;
}

interface Prepared {
  root: string;
  path: string;
  partial: DispatchRecord;
}

async function fetchBase(
  run: Runner,
  root: string,
  remotes: ReadonlySet<string>,
  base: string,
): Promise<void> {
  const remote = baseRemote(remotes, base);
  if (remote == null) return;
  const url = await required(run, ["git", "-C", root, "remote", "get-url", remote], null);
  const fetchOptions: RunOptions = {
    timeoutMs: FETCH_TIMEOUT_MS,
    env: { GIT_TERMINAL_PROMPT: "0" },
  };
  const args = fetchArgs(remote, url.stdout);
  // Without an HTTPS credential, a private repository is reachable only over the remote's own URL.
  const https =
    args.length > 1 ? await run(["git", "-C", root, "fetch", ...args], fetchOptions) : null;
  if (https?.code !== 0)
    await required(run, ["git", "-C", root, "fetch", remote], null, fetchOptions);
}

async function branchExists(
  run: Runner,
  root: string,
  remotes: ReadonlySet<string>,
  branch: string,
): Promise<boolean> {
  const listed = await required(
    run,
    [
      "git",
      "-C",
      root,
      "for-each-ref",
      "--format=%(refname)",
      `refs/heads/${branch}`,
      `refs/remotes/*/${branch}`,
    ],
    null,
  );
  // A pattern also matches refs beneath it, so only an exact name counts.
  const wanted = new Set([
    `refs/heads/${branch}`,
    ...[...remotes].map((remote) => `refs/remotes/${remote}/${branch}`),
  ]);
  return listed.stdout.split("\n").some((line) => wanted.has(line.trim()));
}

// A fork's own main lags its parent, so a checkout with an upstream remote
// branches from the parent's default branch.
async function defaultBase(
  run: Runner,
  root: string,
  remotes: ReadonlySet<string>,
): Promise<string> {
  if (!remotes.has("upstream")) return "origin/main";
  const head = await run([
    "git",
    "-C",
    root,
    "symbolic-ref",
    "--short",
    "refs/remotes/upstream/HEAD",
  ]);
  const ref = head.stdout.trim();
  return head.code === 0 && ref !== "" ? ref : "upstream/main";
}

// The words naming what wt switch checks out. Only a branch that exists
// nowhere is created, and only then does the base matter.
async function switchTarget(
  run: Runner,
  root: string,
  remotes: ReadonlySet<string>,
  options: WorktreeOptions,
): Promise<string[]> {
  if (CHANGE_PATTERN.test(options.branch)) return [options.branch];
  // A local branch needs nothing from the network.
  if (await branchExists(run, root, new Set(), options.branch)) return [options.branch];
  const base = options.base ?? (await defaultBase(run, root, remotes));
  await fetchBase(run, root, remotes, base);
  if (await branchExists(run, root, remotes, options.branch)) return [options.branch];

  const verified = await run(["git", "-C", root, "rev-parse", "--verify", "--quiet", base]);
  if (verified.code !== 0)
    throw new DispatchError(`base ${JSON.stringify(base)} names no commit in ${root}`, null);
  return ["--create", options.branch, "--base", base];
}

function checkoutOf(switched: z.infer<typeof WtSwitched>): Checkout {
  if (switched.action === "existing") return "existing-worktree";
  return switched.created_branch === true ? "new-branch" : "existing-branch";
}

// Resolves to why the repository's worktree admin directory refuses writes,
// or null when it accepts them.
export type Probe = (root: string) => Promise<string | null>;

const DENIED = new Set(["EPERM", "EACCES", "EROFS"]);

// The sandbox makes .git/worktrees read-only, so git worktree add fails only
// after wt has created the branch. Any other error is left for wt to report.
export const probeWorktreeAdmin: Probe = async (root) => {
  const common = await spawnRunner([
    "git",
    "-C",
    root,
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]);
  if (common.code !== 0) return null;
  const admin = join(common.stdout.trim(), "worktrees");
  try {
    await mkdir(admin, { recursive: true });
    await rm(await mkdtemp(join(admin, ".dispatch-probe-")), { recursive: true });
    return null;
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : null;
    if (typeof code !== "string" || !DENIED.has(code)) return null;
    return `${admin} is not writable, so this ran inside the Claude Code sandbox. ${BARE_COMMAND}`;
  }
};

type Launch = Pick<DispatchRecord, "name" | "mux" | "title" | "place">;

export async function prepareWorktree(
  options: WorktreeOptions,
  launch: Launch,
  run: Runner,
  pause: Pause,
  probe: Probe,
  resolve: ResolveRepo,
): Promise<Prepared> {
  let repo: string;
  try {
    repo = await resolve(options.repo, run);
  } catch (error) {
    throw new DispatchError(error instanceof Error ? error.message : String(error), null);
  }
  // The porcelain listing puts the main worktree first whatever the
  // repository's git layout, and wt runs from there.
  const listing = await required(run, ["git", "-C", repo, "worktree", "list", "--porcelain"], null);
  const root = listing.stdout
    .split("\n")
    .find((line) => line.startsWith("worktree "))
    ?.slice("worktree ".length)
    .trim();
  if (root == null || root === "")
    throw new DispatchError(`git named no worktree for ${repo}`, null);

  try {
    const denied = await probe(root);
    if (denied != null) throw new DispatchError(denied, null);
    const listedRemotes = await required(run, ["git", "-C", root, "remote"], null);
    const remotes = new Set(
      listedRemotes.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== ""),
    );
    const target = await switchTarget(run, root, remotes, options);

    const locked = retryConfigLock(run, options.timeout, pause);
    const switched = await requiredJson(
      locked,
      ["wt", "-C", root, "switch", ...target, "--no-cd", "--yes", "--format=json"],
      WtSwitched,
      null,
    );
    const path = switched.path;

    // Everything past here has a worktree behind it, so a failure carries the
    // record forward rather than leaving the checkout orphaned without a trace.
    const partial: DispatchRecord = {
      mux: launch.mux,
      target: null,
      host: null,
      name: launch.name,
      title: launch.title,
      place: launch.place,
      path,
      branch: switched.branch ?? options.branch,
      session: null,
      status: "unknown",
      settings: [],
      checkout: checkoutOf(switched),
    };

    const submoduleError = await initSubmodules(run, path);
    if (submoduleError != null) partial.submoduleError = submoduleError;
    partial.settings = await writeSettings(run, path, options.settings ?? {}, partial);
    return { root, path, partial };
  } catch (error) {
    if (error instanceof DispatchError) error.root ??= root;
    throw error;
  }
}
