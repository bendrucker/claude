#!/usr/bin/env bun
import { cli } from "cleye";
import { realpathSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { decodeJson } from "../../../../packages/decode/index";
import { jsonRow, renderBoard, sortWorktreeRows, type BoardRow } from "./board";
import { daysBefore, deferredPath, readDeferrals, staleKeys } from "./deferred";
import { spawnRun, throttle, type Run } from "./exec";
import {
  createForge,
  forgeKind,
  joinPullRequests,
  MERGED_LIMIT,
  beyondMergedHorizon,
  ownedBy,
  parseRemote,
  pullRequestRef,
  slugParts,
  type Forge,
  type ForgeIdentity,
  type ForgeKind,
  type PullRequestListing,
  type Remote,
} from "./forge";
import {
  ageInDays,
  carriedIgnoredPaths,
  deriveFlags,
  isReusedBranch,
  parseWorktreeList,
  readStatus,
} from "./worktree";

const LABEL = "flock";
const STALE_DAYS = 14;
const GIT_CONCURRENCY = 24;
const FORGE_CONCURRENCY = 12;

const Snapshot = z.looseObject({
  result: z.looseObject({
    snapshot: z.looseObject({
      workspaces: z
        .array(
          z.looseObject({
            workspace_id: z.string(),
            label: z.string().nullish(),
            worktree: z.looseObject({ repo_root: z.string().nullish() }).nullish(),
          }),
        )
        .optional(),
      panes: z
        .array(
          z.looseObject({
            pane_id: z.string(),
            workspace_id: z.string().nullish(),
            agent: z.string().nullish(),
            agent_status: z.string().nullish(),
            cwd: z.string().nullish(),
            foreground_cwd: z.string().nullish(),
          }),
        )
        .optional(),
    }),
  }),
});

interface Pane {
  readonly id: string;
  readonly label: string;
  readonly agent: string;
  readonly cwd: string;
}

interface Repository {
  readonly root: string;
  readonly remote: Remote;
}

interface RepoScan {
  readonly rows: BoardRow[];
  readonly warnings: string[];
}

interface Context {
  readonly git: Run;
  readonly now: number;
  readonly gitlabHost: string | null;
  readonly forgeFor: (kind: ForgeKind) => Forge;
}

function realpath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

async function directories(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(dir, entry.name))
      .toSorted();
  } catch {
    return [];
  }
}

async function entryNames(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

/**
 * Worktrunk wrote worktrees into a repository-local `.worktrees` before it
 * moved to the central path, and checkouts under the old layout are still
 * live, so both are seeded.
 */
async function repoLocalWorktreeDirs(home: string): Promise<string[]> {
  const owners = await directories(join(home, "src"));
  const repos = (await Promise.all(owners.map(directories))).flat();
  const dirs = repos.map((repo) => join(repo, ".worktrees"));
  const present = await Promise.all(dirs.map(async (dir) => (await entryNames(dir)).length > 0));
  return dirs.filter((_, index) => present[index]);
}

/**
 * A worktree with no pane is where work that merged remotely but stayed open
 * locally hides, so the seeds reach past what herdr has actually opened. Every
 * checkout is offered rather than one per directory, because a half-removed
 * one resolves to nothing and would otherwise take its whole repository off
 * the board. The caller keys repositories by root, so the extras collapse.
 */
async function seededCheckouts(home: string): Promise<string[]> {
  const owners = await directories(join(home, "src", ".worktrees"));
  const repoDirs = [
    ...(await Promise.all(owners.map(directories))).flat(),
    ...(await directories(join(home, ".herdr", "worktrees"))),
    ...(await repoLocalWorktreeDirs(home)),
  ];

  const candidates = (await Promise.all(repoDirs.map(directories))).flat();
  const listings = await Promise.all(
    candidates.map(async (path) => ({ path, names: await entryNames(path) })),
  );

  return listings.filter((listing) => listing.names.includes(".git")).map(({ path }) => path);
}

async function resolveRepository(git: Run, dir: string): Promise<Repository | null> {
  const common = await git([
    "git",
    "-C",
    dir,
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]);
  if (!common.ok) return null;

  const trimmed = common.stdout.trim();
  if (trimmed === "") return null;
  const root = realpath(trimmed.endsWith("/.git") ? trimmed.slice(0, -"/.git".length) : trimmed);

  const origin = await git(["git", "-C", root, "remote", "get-url", "origin"]);
  if (!origin.ok) return null;
  const remote = parseRemote(origin.stdout);
  return remote === null ? null : { root, remote };
}

async function defaultBranch(git: Run, root: string): Promise<string | null> {
  const head = await git([
    "git",
    "-C",
    root,
    "symbolic-ref",
    "-q",
    "--short",
    "refs/remotes/origin/HEAD",
  ]);
  const named = head.stdout.trim().replace(/^origin\//, "");
  if (head.ok && named !== "") return named;

  // origin/HEAD goes unset on a checkout that never ran `git remote set-head`,
  // and guessing main against a master repository empties the merged list in
  // silence.
  const [main, master] = await Promise.all(
    ["main", "master"].map((candidate) =>
      git(["git", "-C", root, "rev-parse", "--verify", "--quiet", `origin/${candidate}`]),
    ),
  );
  if (main?.ok === true) return "main";
  return master?.ok === true ? "master" : null;
}

function toCount(stdout: string): number | null {
  const parsed = Number.parseInt(stdout.trim(), 10);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * A worktree whose upstream branch has been deleted fails both counts, and the
 * shell original's `${ahead:-0}` turned that into a fully pushed row.
 */
async function aheadCount(git: Run, worktree: string, base: string | null): Promise<number | null> {
  const upstream = await git(["git", "-C", worktree, "rev-list", "--count", "@{u}..HEAD"]);
  if (upstream.ok) return toCount(upstream.stdout);
  if (base === null) return null;
  const fallback = await git([
    "git",
    "-C",
    worktree,
    "rev-list",
    "--count",
    `origin/${base}..HEAD`,
  ]);
  return fallback.ok ? toCount(fallback.stdout) : null;
}

function branchCommitDates(stdout: string): Map<string, number> {
  const dates = new Map<string, number>();
  for (const line of stdout.split("\n")) {
    const [branch, unix] = line.split("\t");
    if (branch === undefined || unix === undefined) continue;
    const parsed = Number.parseInt(unix, 10);
    if (!Number.isNaN(parsed)) dates.set(branch, parsed);
  }
  return dates;
}

async function resolveForge(
  ctx: Context,
  remote: Remote,
): Promise<{
  identity: ForgeIdentity;
  viewer: string | null;
  listing: PullRequestListing;
  warnings: string[];
}> {
  const kind = forgeKind(remote.host, ctx.gitlabHost);
  if (kind === null) {
    return {
      identity: { slug: remote.slug, forkOf: null, resolved: false },
      viewer: null,
      listing: { open: null, merged: null },
      warnings: [
        `${remote.slug}: ${remote.host} is neither GitHub nor GitLab, so its PR column reads ?`,
      ],
    };
  }

  const forge = ctx.forgeFor(kind);
  const [identity, viewer] = await Promise.all([forge.identity(remote.slug), forge.viewer()]);
  const warnings: string[] = [];
  if (!identity.resolved) {
    warnings.push(
      `${remote.slug}: the forge did not say whether it is a fork, so its owner is shown in full`,
    );
  }

  // A pull request opened from a fork lives in the parent repository, so the
  // fork's own slug returns nothing.
  const listing = await forge.pullRequests(identity.slug);
  if (listing.open === null) {
    warnings.push(
      `${identity.slug}: open pull requests could not be listed, so its PR column reads ?`,
    );
  }
  if (listing.merged === null) {
    warnings.push(
      `${identity.slug}: merged pull requests could not be listed, so its PR column reads ?`,
    );
  }

  return { identity, viewer, listing, warnings };
}

async function scanWorktree(
  ctx: Context,
  options: {
    readonly path: string;
    readonly base: string | null;
    readonly commitDate: number | null;
  },
): Promise<{
  status: ReturnType<typeof readStatus>;
  ahead: number | null;
  carried: number;
  commit: number | null;
}> {
  const [status, ahead, carried, detachedDate] = await Promise.all([
    ctx.git(["git", "-C", options.path, "status", "--porcelain", "-z", "--ignore-submodules=none"]),
    aheadCount(ctx.git, options.path, options.base),
    carriedIgnoredPaths(ctx.git, options.path),
    options.commitDate === null
      ? ctx.git(["git", "-C", options.path, "log", "-1", "--format=%ct", "HEAD"])
      : Promise.resolve(null),
  ]);

  const commit =
    options.commitDate ??
    (detachedDate !== null && detachedDate.ok ? toCount(detachedDate.stdout) : null);

  return { status: readStatus(status), ahead, carried: carried.length, commit };
}

async function scanRepository(ctx: Context, repository: Repository): Promise<RepoScan> {
  const { root, remote } = repository;
  const warnings: string[] = [];

  const [forge, base, refs, worktrees] = await Promise.all([
    resolveForge(ctx, remote),
    defaultBranch(ctx.git, root),
    ctx.git([
      "git",
      "-C",
      root,
      "for-each-ref",
      "--format=%(refname:short)\t%(committerdate:unix)",
      "refs/heads/",
    ]),
    ctx.git(["git", "-C", root, "worktree", "list", "--porcelain"]),
  ]);

  warnings.push(...forge.warnings);
  const target = forge.identity.slug;

  if (base === null) {
    warnings.push(`${target}: no default branch on origin, so merged branches go unflagged`);
  }
  if (!worktrees.ok) {
    warnings.push(`${target}: worktrees could not be listed, so none of its rows appear below`);
  }

  const mergedBranches =
    base === null
      ? new Set<string>()
      : new Set(
          (
            await ctx.git([
              "git",
              "-C",
              root,
              "branch",
              "--format=%(refname:short)",
              "--merged",
              `origin/${base}`,
            ])
          ).stdout
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line !== ""),
        );

  const commitDates = branchCommitDates(refs.stdout);
  const pulls = joinPullRequests(forge.listing.open ?? [], forge.listing.merged ?? []);

  const unknownColumn = forge.listing.open === null || forge.listing.merged === null;
  const { owner, repo } = slugParts(target);
  const ownedByViewer = ownedBy(target, forge.viewer);
  const repoLabel = ownedByViewer ? repo : target;

  const records = parseWorktreeList(worktrees.stdout).filter(
    (record) => realpath(record.path) !== root,
  );

  const scanned = await Promise.all(
    records.map(async (record) => {
      const commitDate = record.branch === null ? null : (commitDates.get(record.branch) ?? null);
      const scan = await scanWorktree(ctx, { path: record.path, base, commitDate });

      const pull = record.branch === null ? undefined : pulls.get(record.branch);
      const flags = deriveFlags({
        detached: record.branch === null,
        status: scan.status,
        ahead: scan.ahead,
        carried: scan.carried,
        merged: record.branch !== null && mergedBranches.has(record.branch),
        reused: isReusedBranch(pull, scan.commit),
      });

      const row: BoardRow = {
        kind: "worktree",
        pane: null,
        agent: null,
        owner,
        repo,
        slug: target,
        forkOf: forge.identity.forkOf,
        ownedByViewer,
        repoLabel,
        branch: record.branch,
        detached: record.branch === null,
        worktree: record.path,
        pull:
          pull === undefined
            ? null
            : { ref: pullRequestRef(pull), number: pull.number, state: pull.state },
        prColumn: pull === undefined ? (unknownColumn ? "?" : "-") : pullRequestRef(pull),
        age: ageInDays(scan.commit, ctx.now),
        flags,
      };
      return { row, commit: scan.commit };
    }),
  );

  const merged = forge.listing.merged;
  if (merged !== null) {
    const beyond = beyondMergedHorizon(
      merged,
      scanned.map(({ row, commit }) => ({
        branch: row.branch ?? "",
        commit,
        matched: row.pull !== null,
      })),
    );
    if (beyond.length > 0) {
      warnings.push(
        `${target}: ${beyond.join(", ")} ${beyond.length === 1 ? "predates" : "predate"} the last ${MERGED_LIMIT} merged pull requests, so a merged one would go unflagged`,
      );
    }
  }

  return { rows: scanned.map((entry) => entry.row), warnings };
}

function readPanes(snapshot: z.infer<typeof Snapshot>): {
  panes: Pane[];
  repoRoots: string[];
  flockWorkspace: string;
} {
  const inner = snapshot.result.snapshot;
  const workspaces = inner.workspaces ?? [];
  const labels = new Map(
    workspaces.map((workspace) => [workspace.workspace_id, workspace.label ?? ""]),
  );

  const panes = (inner.panes ?? [])
    .map((pane) => {
      const agent = pane.agent ?? "";
      return {
        id: pane.pane_id,
        label: labels.get(pane.workspace_id ?? "") ?? "",
        agent: `${agent === "" ? "shell" : agent}/${pane.agent_status ?? "?"}`,
        cwd: pane.foreground_cwd ?? pane.cwd ?? "",
      };
    })
    .toSorted((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));

  const repoRoots = workspaces
    .map((workspace) => workspace.worktree?.repo_root ?? "")
    .filter((root) => root !== "");

  const flockWorkspace =
    workspaces.find((workspace) => (workspace.label ?? "") === LABEL)?.workspace_id ?? "";

  return { panes, repoRoots, flockWorkspace };
}

function attachPanes(
  rows: readonly BoardRow[],
  panes: readonly Pane[],
): { rows: BoardRow[]; claimed: Set<string> } {
  const claimed = new Set<string>();
  const attached = rows.map((row) => {
    const worktree = row.worktree;
    if (worktree === null) return row;
    const pane = panes.find(
      (candidate) => candidate.cwd === worktree || candidate.cwd.startsWith(`${worktree}/`),
    );
    if (pane === undefined) return row;
    claimed.add(pane.id);
    return { ...row, pane: pane.id, agent: pane.agent };
  });
  return { rows: attached, claimed };
}

function idlePaneRows(
  panes: readonly Pane[],
  claimed: ReadonlySet<string>,
  self: string,
): BoardRow[] {
  return panes
    .filter((pane) => !pane.agent.startsWith("shell/") && pane.id !== self && !claimed.has(pane.id))
    .map((pane) => ({
      kind: "pane" as const,
      pane: pane.id,
      agent: pane.agent,
      owner: "",
      repo: "",
      slug: "",
      forkOf: null,
      ownedByViewer: false,
      repoLabel: pane.label === "" ? "-" : pane.label,
      branch: null,
      detached: false,
      worktree: null,
      pull: null,
      prColumn: "-",
      age: null,
      flags: ["no worktree"],
    }));
}

function statusLines(flockWorkspace: string, self: string, selfWorkspace: string): string[] {
  if (flockWorkspace === "") {
    return [
      `FLOCK  status=UNCLAIMED  self=${self}`,
      `  No workspace is labelled "${LABEL}". Claim this one, or create one, before sweeping.`,
    ];
  }
  if (flockWorkspace === selfWorkspace) {
    return [`FLOCK  status=OK  workspace=${flockWorkspace}  self=${self}`];
  }
  return [
    `FLOCK  status=ELSEWHERE  workspace=${flockWorkspace}  self=${self}`,
    `  The flock already lives in ${flockWorkspace}. Focus it and stop, rather than sweeping from here.`,
  ];
}

async function deferralLines(path: string, today: Date): Promise<string[]> {
  let deferrals;
  try {
    deferrals = await readDeferrals(path);
  } catch {
    return [`deferred: file unreadable (${path})`];
  }

  const keys = Object.keys(deferrals);
  if (keys.length === 0) return [];

  return [
    `deferred: ${keys.length} (${keys.join(", ")})`,
    ...staleKeys(deferrals, daysBefore(today, STALE_DAYS)).map(
      (key) =>
        `  stale >${STALE_DAYS}d, re-raise: ${key} - ${deferrals[key]?.reason ?? "no reason recorded"}`,
    ),
  ];
}

async function gitlabHostname(run: Run): Promise<string | null> {
  const result = await run(["glab", "config", "get", "host"]);
  const host = result.stdout.trim();
  return result.ok && host !== "" ? host : null;
}

async function board(json: boolean): Promise<string> {
  const self = process.env.HERDR_PANE_ID ?? "";
  if (self === "") {
    return "NO HERDR (HERDR_PANE_ID unset). flock coordinates a herdr server and there is none here. Stop and say so.";
  }

  const missing = ["herdr", "git"].find((tool) => Bun.which(tool) === null);
  if (missing !== undefined) return `NO HERDR (${missing} is not on PATH). Stop and say so.`;

  const raw = await spawnRun(["herdr", "api", "snapshot"]);
  if (!raw.ok || !raw.stdout.startsWith("{")) {
    const first = raw.stderr.split("\n")[0]?.trim() ?? "";
    const reason = first === "" ? "no output" : first;
    return `NO HERDR (snapshot failed: ${reason}). Stop and say so.`;
  }

  let snapshot;
  try {
    snapshot = decodeJson(Snapshot, raw.stdout, "herdr api snapshot");
  } catch {
    return "NO HERDR (snapshot was not the expected shape). Stop and say so.";
  }

  const { panes, repoRoots, flockWorkspace } = readPanes(snapshot);
  const git = throttle(spawnRun, GIT_CONCURRENCY);
  const forgeRun = throttle(spawnRun, FORGE_CONCURRENCY);
  const forges = new Map<ForgeKind, Forge>();
  const ctx: Context = {
    git,
    now: Math.floor(Date.now() / 1000),
    gitlabHost: Bun.which("glab") === null ? null : await gitlabHostname(forgeRun),
    forgeFor: (kind) => {
      const existing = forges.get(kind);
      if (existing !== undefined) return existing;
      const created = createForge(kind, forgeRun);
      forges.set(kind, created);
      return created;
    },
  };

  const home = process.env.HOME ?? "";
  const seeds = [
    ...new Set([...repoRoots, ...panes.map((pane) => pane.cwd), ...(await seededCheckouts(home))]),
  ].filter((seed) => seed !== "");

  const resolved = await Promise.all(seeds.map((seed) => resolveRepository(git, seed)));
  const repositories = new Map<string, Repository>();
  for (const repository of resolved) {
    if (repository !== null) repositories.set(repository.root, repository);
  }

  const scans = await Promise.all(
    [...repositories.values()].map((repo) => scanRepository(ctx, repo)),
  );
  const warnings = scans.flatMap((scan) => scan.warnings);
  const sorted = sortWorktreeRows(scans.flatMap((scan) => scan.rows));
  const { rows: withPanes, claimed } = attachPanes(sorted, panes);
  const allRows = [...withPanes, ...idlePaneRows(panes, claimed, self)];

  const deferrals = await deferralLines(deferredPath(process.env), new Date());
  const selfWorkspace = process.env.HERDR_WORKSPACE_ID ?? "";

  if (json) {
    return JSON.stringify(
      {
        status:
          flockWorkspace === ""
            ? "UNCLAIMED"
            : flockWorkspace === selfWorkspace
              ? "OK"
              : "ELSEWHERE",
        self,
        workspace: flockWorkspace === "" ? null : flockWorkspace,
        incomplete: warnings,
        rows: allRows.map(jsonRow),
        deferred: deferrals,
      },
      null,
      2,
    );
  }

  return [
    ...statusLines(flockWorkspace, self, selfWorkspace),
    "",
    ...(warnings.length === 0 ? [] : [...warnings.map((warning) => `incomplete: ${warning}`), ""]),
    renderBoard(allRows),
    ...(deferrals.length === 0 ? [] : ["", ...deferrals]),
  ].join("\n");
}

if (import.meta.main) {
  const argv = cli({
    name: "claim",
    flags: {
      json: {
        type: Boolean,
        description: "Emit the board as structured records instead of the table",
      },
    },
    help: {
      description: "Report the flock singleton verdict and the board of every worktree and pane.",
    },
  });

  // Bang-executed at skill load, so stdout is prompt text. A thrown error would
  // land a stack trace in the skill body.
  try {
    console.log(await board(argv.flags.json === true));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.log(`NO HERDR (${reason}). Stop and say so.`);
  }
  process.exit(0);
}
