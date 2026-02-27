#!/usr/bin/env bun

import { exec } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { relative } from "node:path";
import { promisify } from "node:util";
import type { StopHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";
import { validate as validateSettings } from "../settings";

const execAsync = promisify(exec);
const CHECK_TIMEOUT = 30_000;

interface TranscriptEntry {
  type?: string;
  message?: {
    content?: Array<{
      type: string;
      name?: string;
      input?: { file_path?: string };
    }>;
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function parseTranscript(transcriptPath: string): Promise<string[]> {
  if (!(await fileExists(transcriptPath))) {
    return [];
  }

  const content = await readFile(transcriptPath, "utf-8");
  const existChecks: Array<Promise<{ path: string; exists: boolean }>> = [];

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;

    try {
      const entry = JSON.parse(line) as TranscriptEntry;
      if (entry.type !== "assistant" || !entry.message?.content) continue;

      for (const block of entry.message.content) {
        if (block.type !== "tool_use") continue;
        if (block.name !== "Edit" && block.name !== "Write") continue;

        const filePath = block.input?.file_path;
        if (filePath) {
          existChecks.push(fileExists(filePath).then((exists) => ({ path: filePath, exists })));
        }
      }
    } catch {}
  }

  const results = await Promise.all(existChecks);
  const files = new Set<string>();
  for (const { path, exists } of results) {
    if (exists) {
      files.add(path);
    }
  }

  return [...files];
}

export interface Check {
  name: string;
  run: () => Promise<string | null>;
}

function execCheck(command: string, cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    exec(command, { cwd, timeout: CHECK_TIMEOUT }, (error, stdout, stderr) => {
      if (error) {
        const output = (stdout || "") + (stderr || "");
        resolve(output.trim() || error.message);
      } else {
        resolve(null);
      }
    });
  });
}

function extractPluginName(relativePath: string): string | null {
  const match = relativePath.match(/^plugins\/([^/]+)\//);
  return match?.[1] ?? null;
}

export function categorizeChecks(relativePaths: string[], cwd: string): Check[] {
  const checks = new Map<string, Check>();

  const pluginsWithTests = new Set<string>();
  const pluginsToValidate = new Set<string>();
  const pluginsWithHooksToValidate = new Set<string>();
  const pluginsWithSkillsToLint = new Set<string>();
  let needsHookTests = false;
  let needsSettingsValidation = false;
  let needsMarketplaceCheck = false;

  for (const path of relativePaths) {
    const pluginName = extractPluginName(path);

    if (pluginName) {
      pluginsWithTests.add(pluginName);

      if (path === `plugins/${pluginName}/.claude-plugin/plugin.json`) {
        pluginsToValidate.add(pluginName);
      }

      if (path.startsWith(`plugins/${pluginName}/hooks/`)) {
        pluginsWithHooksToValidate.add(pluginName);
      }

      if (path.startsWith(`plugins/${pluginName}/skills/`)) {
        pluginsWithSkillsToLint.add(pluginName);
      }

      needsMarketplaceCheck = true;
    }

    if (path.startsWith(".claude/hooks/") || path.startsWith("user/hooks/")) {
      needsHookTests = true;
    }

    if (path === ".claude/settings.json" || path === "user/settings.json") {
      needsSettingsValidation = true;
    }

    if (path === ".claude-plugin/marketplace.json") {
      needsMarketplaceCheck = true;
    }
  }

  for (const name of pluginsWithTests) {
    checks.set(`test:${name}`, {
      name: `Plugin tests: ${name}`,
      run: () => execCheck(`bun test plugins/${name}/`, cwd),
    });
  }

  for (const name of pluginsToValidate) {
    checks.set(`validate-plugin:${name}`, {
      name: `Plugin validation: ${name}`,
      run: () => execCheck(`bun packages/validate/plugin.ts plugins/${name}`, cwd),
    });
  }

  for (const name of pluginsWithHooksToValidate) {
    checks.set(`validate-hooks:${name}`, {
      name: `Hooks validation: ${name}`,
      run: () => execCheck(`bun packages/validate/hooks.ts plugins/${name}`, cwd),
    });
  }

  for (const name of pluginsWithSkillsToLint) {
    checks.set(`skill-lint:${name}`, {
      name: `Skill lint: ${name}`,
      run: () => execCheck(`bun run skill-lint "plugins/${name}/skills/*"`, cwd),
    });
  }

  if (needsHookTests) {
    checks.set("test:hooks", {
      name: "Hook tests",
      run: () => execCheck("bun test .claude/hooks user/hooks", cwd),
    });
  }

  if (needsSettingsValidation) {
    checks.set("validate:settings", {
      name: "Settings validation",
      run: async () => {
        const errors = await validateSettings(cwd);
        if (errors.size === 0) return null;
        return [...errors.entries()]
          .map(([file, errs]) => `${file}:\n${errs.map((e) => `  - ${e}`).join("\n")}`)
          .join("\n\n");
      },
    });
  }

  if (needsMarketplaceCheck) {
    checks.set("marketplace", {
      name: "Marketplace completeness",
      run: () => execCheck("./scripts/check-marketplace.sh", cwd),
    });
  }

  return [...checks.values()];
}

export async function processStop(input: StopHookInput): Promise<SyncHookJSONOutput | null> {
  if (input.stop_hook_active) {
    return null;
  }

  const files = await parseTranscript(input.transcript_path);
  if (files.length === 0) {
    return null;
  }

  const relativePaths = files.map((f) => relative(input.cwd, f));
  const checks = categorizeChecks(relativePaths, input.cwd);

  if (checks.length === 0) {
    return null;
  }

  const results = await Promise.allSettled(checks.map((c) => c.run()));
  const failures: string[] = [];

  for (const [i, result] of results.entries()) {
    const check = checks[i]!;
    if (result.status === "rejected") {
      failures.push(`${check.name}: ${result.reason}`);
    } else if (result.value) {
      failures.push(`${check.name}:\n${result.value}`);
    }
  }

  if (failures.length === 0) {
    return null;
  }

  return {
    hookSpecificOutput: {
      hookEventName: "Stop",
      additionalContext: `Check failures:\n\n${failures.join("\n\n")}`,
    },
  } as unknown as SyncHookJSONOutput;
}

async function main(): Promise<void> {
  let input: StopHookInput;
  try {
    input = await readStdinJson<StopHookInput>();
  } catch {
    return;
  }

  if (input.hook_event_name !== "Stop") return;

  const output = await processStop(input);
  if (output) {
    writeStdoutJson(output);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
