#!/usr/bin/env bun

import { realpath } from "../../scripts/realpath";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { type HookInput, readHookInput } from "../../scripts/hook-input";
import { timeHook } from "../../scripts/hook-metrics";

// The 1Password plugin's Bash hook requires every registered destination under
// the session's cwd to be a live FIFO. A destination in a linked worktree
// outlives the worktree, so it blocks every session rooted above it until
// someone deletes it by hand in the 1Password app.

const MountInput = z.looseObject({ mountPath: z.string().optional().catch(undefined) });

const Cwd = z.looseObject({ cwd: z.string().optional().catch(undefined) });

const GitPaths = z.tuple([z.string(), z.string(), z.string()]);

const WorktreeRecord = z.tuple([z.string().startsWith("worktree ")], z.string());

// A mount path's directory may not exist yet, so resolve the closest ancestor
// that does and carry the rest of the path over unresolved.
function resolveFromAncestor(path: string): { dir: string; resolved: string } {
  let dir = dirname(path);
  let real = realpath(dir);
  while (real == null) {
    dir = dirname(dir);
    real = realpath(dir);
  }
  return { dir: real, resolved: join(real, relative(dir, path)) };
}

interface Checkout {
  toplevel: string;
  linked: boolean;
}

function git(dir: string, ...args: string[]): string | null {
  const result = Bun.spawnSync(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "ignore" });
  return result.exitCode === 0 ? result.stdout.toString().trim() : null;
}

function checkoutOf(dir: string): Checkout | null {
  const out = git(
    dir,
    "rev-parse",
    "--path-format=absolute",
    "--show-toplevel",
    "--git-dir",
    "--git-common-dir",
  );
  const parsed = GitPaths.safeParse(out?.split("\n"));
  if (!parsed.success) return null;
  const [toplevel, gitDir, commonDir] = parsed.data.map(realpath);
  if (toplevel == null || gitDir == null || commonDir == null) return null;
  return { toplevel, linked: gitDir !== commonDir };
}

// A submodule or nested repository inside a linked worktree is its own main
// checkout, yet removing the outer worktree still removes the destination.
function enclosingLinkedWorktree(dir: string): Checkout | null {
  let checkout = checkoutOf(dir);
  while (checkout != null && !checkout.linked) {
    const parent = dirname(checkout.toplevel);
    if (parent === checkout.toplevel) return null;
    checkout = checkoutOf(parent);
  }
  return checkout;
}

// The first `git worktree list` entry is the main checkout, flagged `bare`
// when the repository has none.
function mainCheckout(dir: string): string | null {
  const out = git(dir, "worktree", "list", "--porcelain");
  const record = WorktreeRecord.safeParse(out?.split("\n\n")[0]?.split("\n"));
  if (!record.success || record.data.includes("bare")) return null;
  return realpath(record.data[0].slice("worktree ".length));
}

function shellQuote(path: string): string {
  return `'${path.replaceAll("'", `'\\''`)}'`;
}

export function denyReason(mountPath: string, source: string | null): string {
  const base = `\`${mountPath}\` is inside a linked git worktree. A 1Password destination there outlives the worktree and blocks Bash in every session rooted above it.`;
  if (source == null) {
    return `${base} Mount at the repository's main checkout instead, then symlink the file into this worktree.`;
  }
  return [
    base,
    `Mount at the main checkout's \`${source}\` instead, skipping that if \`list_local_env_files\` already shows it.`,
    `Then link it into this worktree: \`ln -s ${shellQuote(source)} ${shellQuote(mountPath)}\`.`,
  ].join(" ");
}

export function processInput(input: HookInput): SyncHookJSONOutput | null {
  const raw = MountInput.safeParse(input.tool_input).data?.mountPath;
  if (raw == null || raw === "") return null;
  const expanded = raw.startsWith("~/") ? join(homedir(), raw.slice(2)) : raw;
  const cwd = Cwd.safeParse(input).data?.cwd;
  if (!isAbsolute(expanded) && cwd == null) return null;
  const mountPath = isAbsolute(expanded) ? expanded : resolve(cwd ?? "/", expanded);

  const { dir, resolved } = resolveFromAncestor(mountPath);
  const checkout = enclosingLinkedWorktree(dir);
  if (checkout == null) return null;

  const mainPath = mainCheckout(checkout.toplevel);
  const source = mainPath == null ? null : join(mainPath, relative(checkout.toplevel, resolved));

  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: denyReason(mountPath, source),
    },
  };
}

async function main(): Promise<void> {
  let input: HookInput;
  try {
    input = await readHookInput("onepassword-mount");
  } catch (error) {
    console.error(
      `[onepassword-mount] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const output = await timeHook("onepassword-mount", input, () => processInput(input));
  if (output) {
    process.stdout.write(`${JSON.stringify(output)}\n`);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
