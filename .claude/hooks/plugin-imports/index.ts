#!/usr/bin/env bun

import { join } from "node:path";
import type { StopHookInput } from "@anthropic-ai/claude-agent-sdk";
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";

const input = await readStdinJson<StopHookInput>();
if (input.hook_event_name !== "Stop" || input.stop_hook_active) process.exit(0);

const scriptPath = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "scripts",
  "check-plugin-imports.ts",
);
const proc = Bun.spawn(["bun", scriptPath], {
  cwd: input.cwd,
  stdout: "pipe",
  stderr: "pipe",
});

const exitCode = await proc.exited;
if (exitCode === 0) process.exit(0);

const stderr = await new Response(proc.stderr).text();
writeStdoutJson({
  decision: "block",
  reason: `Cross-plugin imports detected:\n\n${stderr}\n\nFix these imports before stopping. Plugins must not import from outside their own directory.`,
});
