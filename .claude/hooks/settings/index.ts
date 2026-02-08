#!/usr/bin/env bun

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { StopHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const SCHEMA_URL = "https://json.schemastore.org/claude-code-settings.json";
const FETCH_TIMEOUT = 3000;

const SETTINGS_FILES = [".claude/settings.json", "user/settings.json"];

async function fetchSchema(): Promise<object | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    const response = await fetch(SCHEMA_URL, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) return null;
    return (await response.json()) as object;
  } catch {
    return null;
  }
}

async function readSettingsFile(path: string): Promise<object | null> {
  try {
    const content = await readFile(path, "utf-8");
    return JSON.parse(content) as object;
  } catch {
    return null;
  }
}

export async function validate(cwd: string): Promise<Map<string, string[]>> {
  const schema = await fetchSchema();
  if (!schema) return new Map();

  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validateFn = ajv.compile(schema);

  const errors = new Map<string, string[]>();

  for (const file of SETTINGS_FILES) {
    const fullPath = join(cwd, file);
    const settings = await readSettingsFile(fullPath);
    if (!settings) continue;

    if (!validateFn(settings) && validateFn.errors) {
      errors.set(
        file,
        validateFn.errors.map((e) => `${e.instancePath || "/"}: ${e.message}`),
      );
    }
  }

  return errors;
}

async function main(): Promise<void> {
  let input: StopHookInput;
  try {
    input = await readStdinJson<StopHookInput>();
  } catch {
    return;
  }

  if (input.hook_event_name !== "Stop") return;

  const errors = await validate(input.cwd);
  if (errors.size === 0) return;

  const details = [...errors.entries()]
    .map(([file, errs]) => `${file}:\n${errs.map((e) => `  - ${e}`).join("\n")}`)
    .join("\n\n");

  const output: SyncHookJSONOutput = {
    hookSpecificOutput: {
      hookEventName: "Stop",
      additionalContext: `Settings validation errors:\n\n${details}`,
    },
  };

  writeStdoutJson(output);
}

if (import.meta.main) {
  main().catch(console.error);
}
