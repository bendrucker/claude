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
});

export type Spawn = (cmd: string[]) => Promise<number>;

export interface Deps {
  spawn: Spawn;
  hasNodeModules: () => Promise<boolean>;
  missingTypes: () => Promise<string[]>;
}

const defaults: Deps = {
  spawn: async (cmd) => Bun.spawn(cmd, { cwd: ROOT, stdout: "ignore", stderr: "inherit" }).exited,
  // `bun run check` needs oxlint, so its binary stands in for a complete install.
  hasNodeModules: () => Bun.file(join(ROOT, "node_modules", ".bin", "oxlint")).exists(),
  missingTypes: async () => {
    const { mods } = modPlugins(await loadPlugins());
    const present = await Promise.all(
      mods.map((plugin) =>
        Bun.file(join(typesDir(plugin.dir ?? ""), "claude-code", "index.d.ts")).exists(),
      ),
    );
    return mods.filter((_, index) => !present[index]).map((plugin) => plugin.name);
  },
};

function failed(step: string): SyncHookJSONOutput {
  return {
    systemMessage: `mod-types: \`${step}\` failed at session start, so lint and type checks will flag mods that import \`claude-code\`. Run \`bun install && bun run mod-types\` before checking.`,
  };
}

/**
 * A fresh cloud checkout has no node_modules and no engine types, so `bun run check`
 * resolves `claude-code` to an error type in every mod. Local checkouts keep the
 * types from earlier plugin loads, and CI generates them in its own step.
 */
export async function processSessionStart(
  env: Record<string, string | undefined> = process.env,
  deps: Deps = defaults,
): Promise<SyncHookJSONOutput | null> {
  if (env.CLAUDE_CODE_REMOTE !== "true") return null;

  if (
    !(await deps.hasNodeModules()) &&
    (await deps.spawn(["bun", "install", "--frozen-lockfile"])) !== 0
  )
    return failed("bun install");
  const missing = await deps.missingTypes();
  if (missing.length === 0) return null;
  if ((await deps.spawn(["bun", "scripts/mod-types.ts"])) !== 0) return failed("bun run mod-types");
  // Reported as context so hook metrics separate a generating run from a no-op.
  return {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: `Generated mod engine types for ${missing.join(", ")}.`,
    },
  };
}

async function main(): Promise<void> {
  const input = await decodeStdin(SessionStartInput, "mod-types hook input");
  const output = await timeHook("mod-types", input, () => processSessionStart());
  if (output) process.stdout.write(`${JSON.stringify(output)}\n`);
}

if (import.meta.main) {
  main().catch(console.error);
}
