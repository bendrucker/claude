#!/usr/bin/env bun

import { join } from "node:path";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { decodeStdin } from "../../../packages/decode/index";
import { loadPlugins } from "../../../packages/marketplace/index";
import { modPlugins, typesDir } from "../../../scripts/mod-types";
import { timeHook } from "../../../user/scripts/hook-metrics";

const ROOT = join(import.meta.dirname, "..", "..", "..");

const SessionStartInput = z.looseObject({
  hook_event_name: z.literal("SessionStart"),
  session_id: z.string().optional(),
  cwd: z.string().optional(),
});

export type Spawn = (cmd: string[]) => Promise<number>;

export interface Deps {
  spawn: Spawn;
  hasNodeModules: () => Promise<boolean>;
  missingTypes: () => Promise<string[]>;
}

const depsFor = (root: string): Deps => ({
  spawn: async (cmd) => Bun.spawn(cmd, { cwd: root, stdout: "ignore", stderr: "inherit" }).exited,
  // `bun run check` needs oxlint, so its binary stands in for a complete install.
  hasNodeModules: () => Bun.file(join(root, "node_modules", ".bin", "oxlint")).exists(),
  missingTypes: async () => {
    const { mods } = modPlugins(await loadPlugins());
    const present = await Promise.all(
      mods.map((plugin) =>
        Bun.file(join(typesDir(plugin.dir ?? ""), "claude-code", "index.d.ts")).exists(),
      ),
    );
    return mods.filter((_, index) => !present[index]).map((plugin) => plugin.name);
  },
});

const defaults = depsFor(ROOT);

function failed(step: string, consequence: string): SyncHookJSONOutput {
  return {
    systemMessage: `mod-types: \`${step}\` failed at session start, so ${consequence}. Run \`bun install && bun run mod-types\` before checking.`,
  };
}

// Reported as context so hook metrics separate a working run from a no-op.
function context(text: string): SyncHookJSONOutput {
  return { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text } };
}

const INSTALLED = "Installed dependencies with `bun install --frozen-lockfile`.";

/**
 * Installs dependencies into a checkout that has none, then generates engine types in a cloud session.
 */
export async function processSessionStart(
  env: Record<string, string | undefined> = process.env,
  deps: Deps = defaults,
  setStage?: (stage: string) => void,
): Promise<SyncHookJSONOutput | null> {
  let installed = false;
  if (!(await deps.hasNodeModules())) {
    if ((await deps.spawn(["bun", "install", "--frozen-lockfile"])) !== 0) {
      setStage?.("install-failed");
      return failed("bun install", "every script that imports a dependency will fail");
    }
    setStage?.("installed");
    installed = true;
  }

  // Local checkouts keep engine types from earlier plugin loads, and CI generates its own.
  if (env.CLAUDE_CODE_REMOTE !== "true") return installed ? context(INSTALLED) : null;
  const missing = await deps.missingTypes();
  if (missing.length === 0) return installed ? context(INSTALLED) : null;
  if ((await deps.spawn(["bun", "scripts/mod-types.ts"])) !== 0)
    return failed(
      "bun run mod-types",
      "lint and type checks will flag mods that import `claude-code`",
    );
  return context(`Generated mod engine types for ${missing.join(", ")}.`);
}

// Desktop runs project hooks from the main checkout even in a `.claude/worktrees/<name>`
// session, so the session's own checkout comes from the input's `cwd`.
async function checkoutRoot(cwd: string | undefined): Promise<string> {
  if (cwd === undefined) return ROOT;
  const git = Bun.spawn(["git", "rev-parse", "--show-toplevel"], {
    cwd,
    stdout: "pipe",
    stderr: "ignore",
  });
  const [stdout, code] = await Promise.all([new Response(git.stdout).text(), git.exited]);
  return code === 0 && stdout.trim() !== "" ? stdout.trim() : ROOT;
}

async function main(): Promise<void> {
  const input = await decodeStdin(SessionStartInput, "mod-types hook input");
  const deps = depsFor(await checkoutRoot(input.cwd));
  const output = await timeHook("mod-types", input, (setStage) =>
    processSessionStart(process.env, deps, setStage),
  );
  if (output) process.stdout.write(`${JSON.stringify(output)}\n`);
}

if (import.meta.main) {
  main().catch(console.error);
}
