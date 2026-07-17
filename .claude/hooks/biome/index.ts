#!/usr/bin/env bun

import { exec } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type {
  PostToolUseHookInput,
  PreToolUseHookInput,
  StopHookInput,
  SyncHookJSONOutput,
} from "@anthropic-ai/claude-agent-sdk";

const execAsync = promisify(exec);

const BIOME_EXTENSIONS = new Set(["ts", "tsx", "js", "jsx", "json", "jsonc"]);

type HookInput = PostToolUseHookInput | PreToolUseHookInput | StopHookInput;

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

function getExtension(filePath: string): string {
  const parts = filePath.split(".");
  return parts.length > 1 ? (parts.at(-1) ?? "") : "";
}

// Workflow scripts persisted under session state (<transcript dir>/workflows/
// scripts/) are generated runtime artifacts: the workflow runner wraps them in
// an async function body, so their top-level `return` is valid at runtime but
// can never parse as a standalone module.
const WORKFLOW_SCRIPT_SEGMENT = "/workflows/scripts/";

function isBiomeFile(filePath: string): boolean {
  if (filePath.includes(WORKFLOW_SCRIPT_SEGMENT)) {
    return false;
  }
  const ext = getExtension(filePath);
  return BIOME_EXTENSIONS.has(ext);
}

async function fileExists(filePath: string): Promise<boolean> {
  return Bun.file(filePath).exists();
}

// Biome ships as a devDependency, so its binary lives in the module graph
// rather than on PATH (`bun run` adds node_modules/.bin, but `bun test` and
// direct hook invocation do not). Resolve it through the package and run it
// with bun, falling back to a global install only when the package is absent.
function localBiome(): string | null {
  try {
    return fileURLToPath(import.meta.resolve("@biomejs/biome/bin/biome"));
  } catch {
    return null;
  }
}

async function biomeCommand(): Promise<string | null> {
  const local = localBiome();
  if (local) {
    return `bun "${local}"`;
  }
  try {
    await execAsync("command -v biome");
    return "biome";
  } catch {
    return null;
  }
}

async function hasBiome(): Promise<boolean> {
  return (await biomeCommand()) !== null;
}

export async function parseTranscript(transcriptPath: string): Promise<string[]> {
  if (!(await fileExists(transcriptPath))) {
    return [];
  }

  const content = await Bun.file(transcriptPath).text();
  const files = new Set<string>();
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
        if (filePath && isBiomeFile(filePath)) {
          existChecks.push(fileExists(filePath).then((exists) => ({ path: filePath, exists })));
        }
      }
    } catch {}
  }

  const results = await Promise.all(existChecks);
  for (const { path, exists } of results) {
    if (exists) {
      files.add(path);
    }
  }

  return [...files];
}

// Biome derives its project root from the working directory. Running from an
// ancestor of a nested git worktree makes Biome discover that worktree's own
// root biome.json and reject the pair as a nested root configuration, so it
// never lints the file. Running from inside the file's own working tree scopes
// Biome to the config that governs the file and avoids the collision. Files
// outside any git repository fall back to Biome's default resolution.
async function biomeWorkingTree(filePath: string): Promise<string | undefined> {
  try {
    const { stdout } = await execAsync("git rev-parse --show-toplevel", {
      cwd: dirname(filePath),
    });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

// --no-errors-on-unmatched keeps Biome from exiting non-zero on files its
// config ignores (gitignored paths, fixtures). Without it, edits to excluded
// files read as lint failures and block Stop.
export async function runBiomeCheck(filePath: string): Promise<string | null> {
  const command = await biomeCommand();
  if (!command) {
    return null;
  }
  const cwd = await biomeWorkingTree(filePath);
  try {
    await execAsync(
      `${command} check --no-errors-on-unmatched "${filePath}"`,
      cwd ? { cwd } : undefined,
    );
    return null;
  } catch (error) {
    const execError = error as { stdout?: string; stderr?: string };
    const output = (execError.stdout || "") + (execError.stderr || "");
    return output.trim() || null;
  }
}

export async function runBiomeFix(filePath: string): Promise<void> {
  const command = await biomeCommand();
  if (!command) {
    return;
  }
  const cwd = await biomeWorkingTree(filePath);
  try {
    await execAsync(
      `${command} check --write --no-errors-on-unmatched "${filePath}"`,
      cwd ? { cwd } : undefined,
    );
  } catch {
    // biome check --write exits non-zero if there are unfixable issues
  }
}

function formatPostToolUseOutput(filePath: string, errors: string): SyncHookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: `⚠️ Biome found issues in ${filePath}:\n\n${errors}\n\nThese will be checked again before the session ends.`,
    },
  };
}

function formatStopOutput(issues: Map<string, string>): SyncHookJSONOutput {
  const details = [...issues.entries()].map(([file, errors]) => `${file}:\n${errors}`).join("\n\n");

  return {
    decision: "block",
    reason: `❌ Biome check failed. Auto-fix was attempted but issues remain:\n\n${details}\n\nFix these issues before stopping.`,
  };
}

export async function processPostToolUse(
  input: PostToolUseHookInput,
): Promise<SyncHookJSONOutput | null> {
  const toolName = input.tool_name;
  if (toolName !== "Edit" && toolName !== "Write") {
    return null;
  }

  const filePath = (input.tool_input as { file_path?: string }).file_path;
  if (!filePath || !isBiomeFile(filePath)) {
    return null;
  }

  if (!(await hasBiome())) {
    return null;
  }

  const errors = await runBiomeCheck(filePath);
  if (!errors) {
    return null;
  }

  return formatPostToolUseOutput(filePath, errors);
}

export async function processStop(input: StopHookInput): Promise<SyncHookJSONOutput | null> {
  if (input.stop_hook_active) {
    return null;
  }

  if (!(await hasBiome())) {
    return null;
  }

  const files = await parseTranscript(input.transcript_path);
  if (files.length === 0) {
    return null;
  }

  await Promise.all(files.map(runBiomeFix));

  const checkResults = await Promise.all(
    files.map(async (file) => ({ file, errors: await runBiomeCheck(file) })),
  );

  const remainingIssues = new Map<string, string>();
  for (const { file, errors } of checkResults) {
    if (errors) {
      remainingIssues.set(file, errors);
    }
  }

  if (remainingIssues.size === 0) {
    return null;
  }

  return formatStopOutput(remainingIssues);
}

async function getStagedBiomeFiles(): Promise<string[]> {
  try {
    const { stdout } = await execAsync("git diff --cached --name-only --diff-filter=ACMR");
    const files = stdout
      .trim()
      .split("\n")
      .filter((f) => f && isBiomeFile(f));

    const cwd = process.cwd();
    const existChecks = files.map(async (f) => {
      const fullPath = f.startsWith("/") ? f : `${cwd}/${f}`;
      return { path: fullPath, exists: await fileExists(fullPath) };
    });

    const results = await Promise.all(existChecks);
    return results.filter((r) => r.exists).map((r) => r.path);
  } catch {
    return [];
  }
}

function formatPreToolUseBlockOutput(issues: Map<string, string>): SyncHookJSONOutput {
  const details = [...issues.entries()].map(([file, errors]) => `${file}:\n${errors}`).join("\n\n");

  return {
    decision: "block",
    reason: `Biome found issues in staged files:\n\n${details}\n\nFix these issues before committing.`,
  };
}

export async function processPreToolUse(
  _input: PreToolUseHookInput,
): Promise<SyncHookJSONOutput | null> {
  if (!(await hasBiome())) {
    return null;
  }

  const files = await getStagedBiomeFiles();
  if (files.length === 0) {
    return null;
  }

  await Promise.all(files.map(runBiomeFix));

  const checkResults = await Promise.all(
    files.map(async (file) => ({ file, errors: await runBiomeCheck(file) })),
  );

  const remainingIssues = new Map<string, string>();
  for (const { file, errors } of checkResults) {
    if (errors) {
      remainingIssues.set(file, errors);
    }
  }

  if (remainingIssues.size === 0) {
    return null;
  }

  return formatPreToolUseBlockOutput(remainingIssues);
}

export async function processInput(input: HookInput): Promise<SyncHookJSONOutput | null> {
  if (input.hook_event_name === "PreToolUse") {
    return processPreToolUse(input as PreToolUseHookInput);
  }
  if (input.hook_event_name === "PostToolUse") {
    return processPostToolUse(input as PostToolUseHookInput);
  }
  if (input.hook_event_name === "Stop") {
    return processStop(input as StopHookInput);
  }
  return null;
}

async function main(): Promise<void> {
  let input: HookInput;
  try {
    input = JSON.parse(await Bun.stdin.text()) as HookInput;
  } catch (error) {
    console.error(
      `[biome] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const output = await processInput(input);
  if (output) {
    process.stdout.write(`${JSON.stringify(output)}\n`);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
