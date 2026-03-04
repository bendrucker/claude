#!/usr/bin/env bun

import * as p from "@clack/prompts";
import { cli } from "cleye";
import { analyze } from "./analyze";
import { buildCommand } from "./command";
import { exec } from "./exec";
import { defaultPaths, loadPluginCatalog } from "./plugins";
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
const plugins = loadPluginCatalog(settingsPath, marketplacePath);

p.intro("claude-launch");

const modelFlag = argv.flags.model;
let aiConfig = await analyze(task, plugins, modelFlag ? { model: modelFlag } : undefined);
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

  aiConfig = await analyze(task, plugins, { ...(modelFlag ? { model: modelFlag } : {}), followUp });
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

await exec({ command, tuiResult });
