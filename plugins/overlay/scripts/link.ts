#!/usr/bin/env bun
// claude:dangerouslyDisableSandbox: writes the .claude symlink inside a checkout, which the command sandbox denies

import { lstat, mkdir, readdir, readlink, rename, rm, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { cli, command } from "cleye";

/** Gitignored entries a real `.claude` may hold and still be adopted into the overlay. */
const ADOPTABLE = new Set([
  "settings.local.json",
  ".cc-writes",
  "worktrees",
  "scheduled_tasks.lock",
]);

const EXCLUDE_ENTRY = "/.claude";

const SCP_LIKE = /^(?:[^@/]+@)?[^/:]+:(.+)$/;

/** The `<owner>/<repo>` key for a remote URL, or null when it names no repository path. */
export function parseRemoteUrl(url: string): string | null {
  const path = remotePath(url.trim());
  if (path == null) return null;

  const segments = path
    .replace(/\.git$/, "")
    .split("/")
    .filter((segment) => segment !== "");
  if (segments.length < 2) return null;
  return segments.join("/");
}

function remotePath(url: string): string | null {
  if (url.includes("://")) {
    try {
      return new URL(url).pathname;
    } catch {
      return null;
    }
  }
  return SCP_LIKE.exec(url)?.[1] ?? null;
}

export function overlayRoot(env: Record<string, string | undefined> = process.env): string {
  const configured = env.CLAUDE_OVERLAYS_ROOT;
  if (configured != null && configured !== "") return configured;
  return join(env.HOME ?? homedir(), ".claude-repo", "overlays");
}

async function git(checkout: string, args: string[]): Promise<string | null> {
  const proc = Bun.spawn(["git", "-C", checkout, ...args], { stdout: "pipe", stderr: "ignore" });
  const output = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0) return null;
  return output.trim();
}

async function remoteKey(checkout: string, remote: string): Promise<string | null> {
  const url = await git(checkout, ["remote", "get-url", remote]);
  if (url == null || url === "") return null;
  return parseRemoteUrl(url);
}

/** The repository key from the `upstream` remote, falling back to `origin`. */
export async function resolveRepoKey(checkout: string): Promise<string | null> {
  const upstream = await remoteKey(checkout, "upstream");
  return upstream ?? (await remoteKey(checkout, "origin"));
}

export type ClaudeState =
  | { kind: "linked" }
  | { kind: "missing" }
  | { kind: "adoptable"; entries: string[] }
  | { kind: "occupied"; reason: string };

/** How a checkout's `.claude` stands relative to the overlay it should point at. */
export async function inspectClaude(path: string, overlay: string): Promise<ClaudeState> {
  let stats: Awaited<ReturnType<typeof lstat>>;
  try {
    stats = await lstat(path);
  } catch {
    return { kind: "missing" };
  }

  if (stats.isSymbolicLink()) {
    const target = resolve(dirname(path), await readlink(path));
    if (target === resolve(overlay)) return { kind: "linked" };
    return { kind: "occupied", reason: `it is a symlink to ${target}` };
  }

  if (!stats.isDirectory()) return { kind: "occupied", reason: "it is a file" };

  const entries = await readdir(path);
  const tracked = entries.filter((entry) => !ADOPTABLE.has(entry));
  if (tracked.length > 0) return { kind: "occupied", reason: `it holds ${tracked.join(", ")}` };
  return { kind: "adoptable", entries };
}

export interface OverlayStatus {
  checkout: string;
  key: string | null;
  overlay: string | null;
  exists: boolean;
  state: ClaudeState | null;
}

/** The overlay for a checkout's remote and the state of the checkout's `.claude`. */
export async function overlayStatus(
  checkout: string,
  root: string = overlayRoot(),
): Promise<OverlayStatus> {
  const key = await resolveRepoKey(checkout);
  if (key == null) return { checkout, key: null, overlay: null, exists: false, state: null };

  const overlay = join(root, key, ".claude");
  if (!(await isDirectory(overlay))) {
    return { checkout, key, overlay, exists: false, state: null };
  }

  const state = await inspectClaude(claudePath(checkout), overlay);
  return { checkout, key, overlay, exists: true, state };
}

function claudePath(checkout: string): string {
  return join(checkout, ".claude");
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

/** The text to append so `info/exclude` carries the entry, or null when it already does. */
export function excludeAddition(contents: string): string | null {
  if (contents.split("\n").some((line) => line.trim() === EXCLUDE_ENTRY)) return null;
  const separator = contents === "" || contents.endsWith("\n") ? "" : "\n";
  return `${separator}${EXCLUDE_ENTRY}\n`;
}

/** Hides the untracked link from git across every worktree sharing the common dir. */
export async function excludeClaude(checkout: string): Promise<void> {
  const commonDir = await git(checkout, ["rev-parse", "--git-common-dir"]);
  if (commonDir == null || commonDir === "") return;

  const info = join(resolve(checkout, commonDir), "info");
  const exclude = join(info, "exclude");
  const file = Bun.file(exclude);
  const contents = (await file.exists()) ? await file.text() : "";

  const addition = excludeAddition(contents);
  if (addition == null) return;

  await mkdir(info, { recursive: true });
  await Bun.write(exclude, contents + addition);
}

export type LinkOutcome =
  | { status: "no-overlay"; key: string | null }
  | { status: "already-linked"; key: string }
  | { status: "linked"; key: string; moved: string[]; kept: string[] }
  | { status: "blocked"; key: string; reason: string };

/** Adopts an existing `.claude` where it only holds gitignored state, then links the overlay. */
export async function link(checkout: string, root: string = overlayRoot()): Promise<LinkOutcome> {
  const { key, overlay, state } = await overlayStatus(checkout, root);
  if (key == null || overlay == null || state == null) return { status: "no-overlay", key };
  if (state.kind === "occupied") return { status: "blocked", key, reason: state.reason };

  await excludeClaude(checkout);
  if (state.kind === "linked") return { status: "already-linked", key };

  const target = claudePath(checkout);
  const adopted = state.kind === "adoptable" ? await adopt(target, overlay, state.entries) : null;
  if (adopted != null) await rm(target, { recursive: true, force: true });

  await symlink(overlay, target);
  return { status: "linked", key, moved: adopted?.moved ?? [], kept: adopted?.kept ?? [] };
}

/** Moves gitignored state into the overlay, keeping the overlay's copy where both exist. */
async function adopt(
  target: string,
  overlay: string,
  entries: string[],
): Promise<{ moved: string[]; kept: string[] }> {
  const results = await Promise.all(
    entries.map(async (entry) => {
      const destination = join(overlay, entry);
      if (await exists(destination)) return { entry, moved: false };
      await rename(join(target, entry), destination);
      return { entry, moved: true };
    }),
  );

  return {
    moved: results.filter((result) => result.moved).map((result) => result.entry),
    kept: results.filter((result) => !result.moved).map((result) => result.entry),
  };
}

function reportLink(outcome: LinkOutcome, checkout: string): number {
  if (outcome.status === "blocked") {
    console.error(
      `${claudePath(checkout)} cannot be replaced by the ${outcome.key} overlay: ${outcome.reason}`,
    );
    return 1;
  }

  if (outcome.status === "linked") {
    if (outcome.kept.length > 0) {
      console.error(`kept the overlay's ${outcome.kept.join(", ")} over the checkout's copy`);
    }
    if (outcome.moved.length > 0) {
      console.error(`moved into the overlay: ${outcome.moved.join(", ")}`);
    }
    console.error(`linked ${claudePath(checkout)} to the ${outcome.key} overlay`);
  }

  return 0;
}

function reportStatus(status: OverlayStatus): void {
  console.log(`repo: ${status.key ?? "no upstream or origin remote"}`);
  console.log(`overlay: ${status.overlay ?? "none"}${status.exists ? "" : " (absent)"}`);
  console.log(`link: ${describeState(status.state)}`);
}

function describeState(state: ClaudeState | null): string {
  if (state == null) return "nothing to link";
  if (state.kind === "linked") return "linked";
  if (state.kind === "occupied") return `not linked, ${state.reason}`;
  if (state.kind === "adoptable" && state.entries.length > 0) {
    return `not linked, .claude holds ${state.entries.join(", ")}`;
  }
  return "not linked";
}

const linkCommand = command(
  {
    name: "link",
    parameters: ["[checkout]"],
    help: { description: "Point a checkout's .claude at its overlay." },
  },
  async (parsed) => {
    const checkout = resolve(parsed._.checkout ?? process.cwd());
    process.exit(reportLink(await link(checkout), checkout));
  },
);

const statusCommand = command(
  {
    name: "status",
    parameters: ["[checkout]"],
    help: { description: "Report the repository key, the overlay, and the link state." },
  },
  async (parsed) => {
    reportStatus(await overlayStatus(resolve(parsed._.checkout ?? process.cwd())));
  },
);

if (import.meta.main) {
  void cli(
    {
      name: "claude-overlay",
      commands: [linkCommand, statusCommand],
      help: { description: "Overlay Claude Code configuration onto a checkout." },
    },
    (parsed) => {
      parsed.showHelp();
    },
  );
}
