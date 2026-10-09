#!/usr/bin/env bun

import { realpath } from "../../scripts/realpath";
import { basename, dirname, join, relative } from "node:path";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { type HookInput, readHookInput } from "../../scripts/hook-input";
import { timeHook } from "../../scripts/hook-metrics";

// The 1Password plugin's Bash hook requires every registered destination under
// the session's cwd to be a live FIFO. A destination in a linked worktree
// outlives the worktree, so it blocks every session rooted above it until
// someone deletes it by hand in the 1Password app.

const MountInput = z.looseObject({ mountPath: z.string().optional().catch(undefined) });

const GitPaths = z.tuple([z.string(), z.string(), z.string()]);

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
  main: string | null;
}

function checkoutOf(dir: string): Checkout | null {
  const result = Bun.spawnSync(
    [
      "git",
      "-C",
      dir,
      "rev-parse",
      "--path-format=absolute",
      "--show-toplevel",
      "--git-dir",
      "--git-common-dir",
    ],
    { stdout: "pipe", stderr: "ignore" },
  );
  if (result.exitCode !== 0) return null;
  const parsed = GitPaths.safeParse(result.stdout.toString().trim().split("\n"));
  if (!parsed.success) return null;
  const [toplevel, gitDir, commonDir] = parsed.data.map(realpath);
  if (toplevel == null || gitDir == null || commonDir == null) return null;
  return {
    toplevel,
    linked: gitDir !== commonDir,
    main: basename(commonDir) === ".git" ? dirname(commonDir) : null,
  };
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
  const mountPath = MountInput.safeParse(input.tool_input).data?.mountPath;
  if (mountPath == null || !mountPath.startsWith("/")) return null;

  const { dir, resolved } = resolveFromAncestor(mountPath);
  const checkout = checkoutOf(dir);
  if (checkout == null || !checkout.linked) return null;

  const source =
    checkout.main == null ? null : join(checkout.main, relative(checkout.toplevel, resolved));

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
