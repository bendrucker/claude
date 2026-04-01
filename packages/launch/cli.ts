#!/usr/bin/env bun

import * as p from "@clack/prompts";
import { cli } from "cleye";
import { buildCommand } from "./command";
import { defaultPaths, loadPluginCatalog } from "./plugins";
import { buildPrompt } from "./prompt";
import type { LaunchConfig } from "./schema";
import { schema } from "./schema";
import type { TuiResult } from "./tui";
import { presentConfig } from "./tui";

const argv = cli({
  name: "claude-launch",
  parameters: ["<task>"],
  flags: {
    model: {
      type: String,
      description: "Override model selection (skip AI choice)",
    },
    dryRun: {
      type: Boolean,
      description: "Preview the command without executing",
      default: false,
    },
  },
});

const task = argv._.task;
const { settingsPath, marketplacePath } = defaultPaths();
const plugins = await loadPluginCatalog(settingsPath, marketplacePath);

async function analyze(task: string, followUp?: string): Promise<LaunchConfig> {
  const prompt = followUp
    ? `${buildPrompt(task, plugins)}\n\n## Follow-up\n\n${followUp}`
    : buildPrompt(task, plugins);

  const s = p.spinner();
  s.start("Analyzing task...");

  const result = Bun.spawnSync(
    [
      "claude",
      "-p",
      "--model",
      "haiku",
      "--output-format",
      "json",
      "--no-session-persistence",
      "--json-schema",
      JSON.stringify(schema),
      prompt,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );

  s.stop("Analysis complete");

  if (result.exitCode !== 0) {
    p.cancel("claude -p failed");
    console.error(result.stderr.toString());
    process.exit(1);
  }

  const output = JSON.parse(result.stdout.toString());
  return {
    ...output,
    ...(argv.flags.model ? { model: argv.flags.model } : {}),
  };
}

p.intro("claude-launch");

let aiConfig = await analyze(task);
p.note(aiConfig.reasoning, "AI reasoning");

let tuiResult: TuiResult;

while (true) {
  const result = await presentConfig(aiConfig, plugins);
  if (p.isCancel(result)) {
    p.cancel("Cancelled");
    process.exit(0);
  }
  tuiResult = result;

  const followUp = await p.text({
    message: "Follow-up prompt (optional, refines AI suggestions)",
    placeholder: "Press enter to continue",
  });

  if (p.isCancel(followUp)) {
    p.cancel("Cancelled");
    process.exit(0);
  }

  if (!followUp) break;

  aiConfig = await analyze(task, followUp);
  p.note(aiConfig.reasoning, "Updated reasoning");
}

const command = buildCommand(tuiResult.config);
p.note(command.display, "Command");

if (argv.flags.dryRun) {
  p.outro("Dry run — command not executed");
  process.exit(0);
}

const shouldExec = await p.confirm({
  message: "Launch?",
  initialValue: true,
});

if (p.isCancel(shouldExec) || !shouldExec) {
  p.outro("Cancelled");
  process.exit(0);
}

const env = { ...process.env, ...command.env };

if (tuiResult.worktree) {
  const execCmd = command.args
    .map((a) => (a.includes(" ") || a.includes("{") ? `'${a}'` : a))
    .join(" ");
  const envPrefix = Object.entries(command.env)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  const fullExec = envPrefix ? `${envPrefix} ${execCmd}` : execCmd;

  const child = Bun.spawn(["wt", "switch", "--create", tuiResult.worktree, "--execute", fullExec], {
    env,
    stdio: ["inherit", "inherit", "inherit"],
  });
  const exitCode = await child.exited;
  process.exit(exitCode);
}

const [cmd = "claude", ...args] = command.args;
const child = Bun.spawn([cmd, ...args], {
  env,
  stdio: ["inherit", "inherit", "inherit"],
});
const exitCode = await child.exited;
process.exit(exitCode);
