#!/usr/bin/env bun

import * as p from "@clack/prompts";
import type { TuiResult } from "claude-launch";
import {
  analyze,
  buildCommand,
  defaultPaths,
  exec,
  loadPluginCatalog,
  presentConfig,
} from "claude-launch";
import { cli } from "cleye";
import type { Mode } from "./context";
import { formatContext, inferMode } from "./context";
import { resolveRepo } from "./resolve";
import { fetchContext, parseUrl } from "./sources";

const argv = cli({
  name: "claude-dispatch",
  parameters: ["<url>"],
  flags: {
    mode: {
      type: String,
      description: "Override mode: plan | review | prefill",
    },
    dryRun: {
      type: Boolean,
      description: "Print enriched task + prompt, don't dispatch",
      default: false,
    },
    json: {
      type: Boolean,
      description: "Output fetched context as JSON",
      default: false,
    },
  },
});

const url = argv._.url;

p.intro("claude-dispatch");

const s = p.spinner();
s.start("Parsing URL...");
const source = parseUrl(url);
s.stop(`Source: ${source.type}`);

s.start("Fetching context...");
const context = await fetchContext(source);
s.stop("Context fetched");

const validModes: Mode[] = ["plan", "review", "prefill"];
const modeFlag = argv.flags.mode;
if (modeFlag && !validModes.includes(modeFlag as Mode)) {
  p.cancel(`Invalid mode: ${modeFlag}. Must be one of: ${validModes.join(", ")}`);
  process.exit(1);
}
const mode: Mode = (modeFlag as Mode | undefined) ?? inferMode(source.type);

if (argv.flags.json) {
  console.log(JSON.stringify(context, null, 2));
  process.exit(0);
}

const xml = formatContext(context, mode);

if (argv.flags.dryRun) {
  console.log(`Mode: ${mode}\n`);
  console.log(xml);
  process.exit(0);
}

const { settingsPath, marketplacePath } = defaultPaths();
const plugins = loadPluginCatalog(settingsPath, marketplacePath);

let aiConfig = await analyze(xml, plugins);
p.note(aiConfig.reasoning, "AI reasoning");

const existingRef =
  context.type === "github-pr" ? (context.metadata.headRefName as string | undefined) : undefined;

let tuiResult: TuiResult;

while (true) {
  const result = await presentConfig(aiConfig, plugins, existingRef ? { existingRef } : {});
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

  aiConfig = await analyze(xml, plugins, { followUp });
  p.note(aiConfig.reasoning, "Updated reasoning");
}

const command = buildCommand(tuiResult.config);
p.note(command.display, "Command");

const repoPath = await resolveRepo(context);

const shouldExec = await p.confirm({
  message: "Launch?",
  initialValue: true,
});

if (p.isCancel(shouldExec) || !shouldExec) {
  p.outro("Cancelled");
  process.exit(0);
}

await exec({ command, tuiResult, cwd: repoPath });
