#!/usr/bin/env bun
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { $ } from "bun";
import { cli } from "cleye";
import { stage } from "./stage";

export interface WrapOptions {
  /** Repository to read from. */
  repo: string;
  /** Git ref to read the artifacts at, or the working tree when absent. */
  ref?: string;
  out: string;
  name: string;
  skills: string[];
  agents: string[];
  /** Documents injected at session start, standing in for CLAUDE.md or a rule file. */
  context: string[];
  /** Suite directory copied to `evals/` so `claude plugin eval` finds it below the plugin. */
  evals?: string;
}

// The runner ignores a CLAUDE.md or .claude/rules in the scaffolded working directory,
// so context reaches the session the way a plugin can deliver it: a SessionStart hook.
const hooks = {
  hooks: {
    SessionStart: [
      {
        hooks: [
          {
            type: "command",
            command:
              'cat "$CLAUDE_PLUGIN_ROOT"/context/* | jq -Rs \'{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: .}}\'',
          },
        ],
      },
    ],
  },
};

/** Materializes a throwaway plugin holding the named artifacts as they stand at a ref. */
export async function wrap(options: WrapOptions): Promise<string> {
  const { out, name } = options;
  const all = [...options.skills, ...options.agents, ...options.context];
  if (options.evals !== undefined) all.push(options.evals);
  const staged = mkdtempSync(join(tmpdir(), "wrap-"));
  await stage(options.repo, options.ref, all, staged);

  await $`rm -rf ${out}`.quiet();
  mkdirSync(join(out, ".claude-plugin"), { recursive: true });
  await Bun.write(join(out, ".claude-plugin/plugin.json"), JSON.stringify({ name }, null, 2));

  const copy = async (paths: string[], dir: string) => {
    if (paths.length === 0) return;
    mkdirSync(join(out, dir), { recursive: true });
    await Promise.all(paths.map((p) => $`cp -R ${join(staged, p)} ${join(out, dir, basename(p))}`));
  };
  await copy(options.skills, "skills");
  await copy(options.agents, "agents");
  await copy(options.context, "context");
  if (options.context.length > 0) {
    await Bun.write(join(out, "hooks/hooks.json"), JSON.stringify(hooks, null, 2));
  }
  if (options.evals !== undefined)
    await $`cp -R ${join(staged, options.evals)} ${join(out, "evals")}`;
  await $`rm -rf ${staged}`.quiet();
  return out;
}

if (import.meta.main) {
  const argv = cli({
    name: "wrap.ts",
    flags: {
      out: { type: String, description: "Directory to write the plugin to (replaced)" },
      ref: { type: String, description: "Git ref to read at; the working tree when absent" },
      repo: { type: String, default: ".", description: "Repository to read from" },
      name: { type: String, default: "user", description: "Plugin name, the skill namespace" },
      skill: { type: [String], description: "Skill directory to include" },
      agent: { type: [String], description: "Agent file to include" },
      context: { type: [String], description: "Document to inject at session start" },
      evals: { type: String, description: "Suite directory to copy to evals/" },
    },
    help: {
      description:
        "Wrap skills, agents, and context documents that are not a plugin into a throwaway plugin, so claude plugin eval can load them from any git ref and ablate them.",
    },
  });
  const { out } = argv.flags;
  if (out === undefined) {
    argv.showHelp();
    process.exit(1);
  }
  const path = await wrap({
    repo: argv.flags.repo,
    ref: argv.flags.ref,
    out,
    name: argv.flags.name,
    skills: argv.flags.skill,
    agents: argv.flags.agent,
    context: argv.flags.context,
    evals: argv.flags.evals,
  });
  console.log(path);
}
