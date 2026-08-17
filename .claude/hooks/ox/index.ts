#!/usr/bin/env bun

import { exec, execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type {
  PostToolUseHookInput,
  PreToolUseHookInput,
  StopHookInput,
  SyncHookJSONOutput,
} from "@anthropic-ai/claude-agent-sdk";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const OX_EXTENSIONS = new Set(["ts", "tsx", "js", "jsx", "json", "jsonc"]);

type HookInput = PostToolUseHookInput | PreToolUseHookInput | StopHookInput;

type BashInput = { command?: string };

// Flags git accepts between the executable and its subcommand. Enumerated
// rather than matched as a generic `-\S+` so that a value which happens to be
// the word `commit` (`git log --grep commit`) cannot be read as the subcommand.
// The git plugin's block-default-branch-commit hook keeps its own copy: it
// ships to other machines and cannot import repo-internal code.
const VALUE_FLAG = String.raw`(?:-[cC]|--(?:git-dir|work-tree|namespace|exec-path|config-env))(?:=\S+|\s+\S+)`;
const BOOLEAN_FLAG =
  "--(?:no-pager|paginate|bare|literal-pathspecs|no-replace-objects|no-optional-locks)";
const GIT_COMMIT_PATTERN = new RegExp(
  String.raw`\bgit\s+(?:(?:${VALUE_FLAG}|${BOOLEAN_FLAG})\s+)*commit(?![\w-])`,
);

// Quoted spans carry commit messages, grep patterns, and here-doc prose, where
// the literal text `git commit` is data rather than an invocation.
function stripQuoted(command: string): string {
  return command.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, " ");
}

export function invokesGitCommit(command: string): boolean {
  return GIT_COMMIT_PATTERN.test(stripQuoted(command));
}

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

function isOxFile(filePath: string): boolean {
  if (filePath.includes(WORKFLOW_SCRIPT_SEGMENT)) {
    return false;
  }
  const ext = getExtension(filePath);
  return OX_EXTENSIONS.has(ext);
}

async function fileExists(filePath: string): Promise<boolean> {
  return Bun.file(filePath).exists();
}

// A gitignored path (scratch under tmp/, a nested worktree) can never be
// committed, so gating Stop on its lint errors blocks the session on throwaway
// content. git check-ignore drops those while keeping new untracked source
// files in scope, which `git ls-files` would not. Paths outside any repo exit
// 128 and stay in scope.
async function isIgnored(filePath: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["check-ignore", "-q", filePath], { cwd: dirname(filePath) });
    return true;
  } catch {
    return false;
  }
}

// oxlint and oxfmt ship as devDependencies, so their binaries live in the
// module graph rather than on PATH (`bun run` adds node_modules/.bin, but
// `bun test` and direct hook invocation do not). Neither package's `exports`
// map declares its `bin/` entry as an importable subpath, so
// `import.meta.resolve("oxlint/bin/oxlint")` throws even when the package is
// installed. `package.json` is exported, so resolve that instead and rejoin
// the package root with the `bin` path from its own manifest.
function localBin(pkg: string, bin: string): string | null {
  try {
    const manifestPath = fileURLToPath(import.meta.resolve(`${pkg}/package.json`));
    return join(dirname(manifestPath), bin);
  } catch {
    return null;
  }
}

async function resolveCommand(
  pkg: string,
  bin: string,
  globalName: string,
): Promise<string | null> {
  const local = localBin(pkg, bin);
  if (local) {
    return `bun "${local}"`;
  }
  try {
    await execAsync(`command -v ${globalName}`);
    return globalName;
  } catch {
    return null;
  }
}

async function oxlintCommand(): Promise<string | null> {
  return resolveCommand("oxlint", "bin/oxlint", "oxlint");
}

async function oxfmtCommand(): Promise<string | null> {
  return resolveCommand("oxfmt", "bin/oxfmt", "oxfmt");
}

async function hasOxTools(): Promise<boolean> {
  const [lint, fmt] = await Promise.all([oxlintCommand(), oxfmtCommand()]);
  return lint !== null && fmt !== null;
}

export async function parseTranscript(transcriptPath: string): Promise<string[]> {
  if (!(await fileExists(transcriptPath))) {
    return [];
  }

  const content = await Bun.file(transcriptPath).text();
  const candidates = new Set<string>();

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;

    try {
      const entry = JSON.parse(line) as TranscriptEntry;
      if (entry.type !== "assistant" || !entry.message?.content) continue;

      for (const block of entry.message.content) {
        if (block.type !== "tool_use") continue;
        if (block.name !== "Edit" && block.name !== "Write") continue;

        const filePath = block.input?.file_path;
        if (filePath && isOxFile(filePath)) {
          candidates.add(filePath);
        }
      }
    } catch {}
  }

  const checks = [...candidates].map(async (path) => ({
    path,
    keep: (await fileExists(path)) && !(await isIgnored(path)),
  }));
  const results = await Promise.all(checks);
  return results.filter((result) => result.keep).map((result) => result.path);
}

// oxlint and oxfmt both discover the nearest ancestor config per file they
// process, so (unlike Biome) they lint and format a nested git worktree
// correctly even when invoked from an ancestor directory. This resolves a
// shared cwd per invocation anyway: it keeps relative paths and any future
// tool-relative resolution anchored to the file's own working tree rather
// than to wherever the hook process happens to start.
async function oxWorkingTree(filePath: string): Promise<string | undefined> {
  try {
    const { stdout } = await execAsync("git rev-parse --show-toplevel", {
      cwd: dirname(filePath),
    });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

// Splits files by resolved working tree so a turn touching a single worktree
// (the common case) becomes one batched process instead of one per file,
// while a turn spanning a nested worktree still runs each group from the cwd
// that governs it.
async function groupByWorkingTree(files: string[]): Promise<Map<string | undefined, string[]>> {
  const resolved = await Promise.all(
    files.map(async (file) => ({ file, cwd: await oxWorkingTree(file) })),
  );
  const groups = new Map<string | undefined, string[]>();
  for (const { file, cwd } of resolved) {
    const group = groups.get(cwd);
    if (group) {
      group.push(file);
    } else {
      groups.set(cwd, [file]);
    }
  }
  return groups;
}

function quoteAll(files: string[]): string {
  return files.map((file) => `"${file}"`).join(" ");
}

function commandOutput(error: unknown): string | null {
  const execError = error as { stdout?: string; stderr?: string };
  const output = (execError.stdout || "") + (execError.stderr || "");
  return output.trim() || null;
}

// --no-error-on-unmatched-pattern keeps oxlint/oxfmt from exiting non-zero on
// files their config ignores (gitignored paths, fixtures). Without it, edits
// to excluded files read as lint or format failures and block Stop.
export async function runOxlintAgent(filePath: string): Promise<string | null> {
  const command = await oxlintCommand();
  if (!command) {
    return null;
  }
  const cwd = await oxWorkingTree(filePath);
  try {
    await execAsync(
      `${command} --no-error-on-unmatched-pattern -f agent "${filePath}"`,
      cwd ? { cwd } : undefined,
    );
    return null;
  } catch (error) {
    return commandOutput(error);
  }
}

async function runOxlintAgentBatch(files: string[]): Promise<string | null> {
  const command = await oxlintCommand();
  if (!command || files.length === 0) {
    return null;
  }
  const groups = await groupByWorkingTree(files);
  const outputs = await Promise.all(
    [...groups.entries()].map(async ([cwd, groupFiles]) => {
      try {
        await execAsync(
          `${command} --no-error-on-unmatched-pattern -f agent ${quoteAll(groupFiles)}`,
          cwd ? { cwd } : undefined,
        );
        return null;
      } catch (error) {
        return commandOutput(error);
      }
    }),
  );
  const combined = outputs.filter((output): output is string => Boolean(output)).join("\n");
  return combined || null;
}

async function runOxfmtWrite(files: string[]): Promise<void> {
  const command = await oxfmtCommand();
  if (!command || files.length === 0) {
    return;
  }
  const groups = await groupByWorkingTree(files);
  await Promise.all(
    [...groups.entries()].map(async ([cwd, groupFiles]) => {
      try {
        await execAsync(
          `${command} --write --no-error-on-unmatched-pattern ${quoteAll(groupFiles)}`,
          cwd ? { cwd } : undefined,
        );
      } catch {
        // oxfmt --write exits non-zero when a file has a syntax error it
        // cannot format. The follow-up oxlint pass surfaces that separately.
      }
    }),
  );
}

// Type-aware lint rules stay off in .oxlintrc.json; --type-aware is enabled
// only because --type-check requires the same type-info plumbing. There is no
// useful per-file mode, so this always runs repo-wide.
async function runTypeCheck(): Promise<string | null> {
  const command = await oxlintCommand();
  if (!command) {
    return null;
  }
  try {
    await execAsync(
      `${command} --type-aware --type-check -f agent --ignore-pattern ".claude/workflows/**"`,
    );
    return null;
  } catch (error) {
    return commandOutput(error);
  }
}

function formatPostToolUseOutput(filePath: string, errors: string): SyncHookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: `⚠️ oxlint found issues in ${filePath}:\n\n${errors}\n\nThese will be checked again before the session ends.`,
    },
  };
}

function formatBlockReason(
  intro: string,
  lintOutput: string | null,
  typeOutput: string | null,
): string {
  const sections = [];
  if (lintOutput) sections.push(`Lint:\n${lintOutput}`);
  if (typeOutput) sections.push(`Types:\n${typeOutput}`);
  return `${intro}\n\n${sections.join("\n\n")}\n\nFix these issues before ${intro.includes("committing") ? "committing" : "stopping"}.`;
}

export async function processPostToolUse(
  input: PostToolUseHookInput,
): Promise<SyncHookJSONOutput | null> {
  const toolName = input.tool_name;
  if (toolName !== "Edit" && toolName !== "Write") {
    return null;
  }

  const filePath = (input.tool_input as { file_path?: string }).file_path;
  if (!filePath || !isOxFile(filePath)) {
    return null;
  }

  if (!(await oxlintCommand())) {
    return null;
  }

  const errors = await runOxlintAgent(filePath);
  if (!errors) {
    return null;
  }

  return formatPostToolUseOutput(filePath, errors);
}

export async function processStop(input: StopHookInput): Promise<SyncHookJSONOutput | null> {
  if (input.stop_hook_active) {
    return null;
  }

  if (!(await hasOxTools())) {
    return null;
  }

  const files = await parseTranscript(input.transcript_path);
  if (files.length === 0) {
    return null;
  }

  await runOxfmtWrite(files);

  const [lintOutput, typeOutput] = await Promise.all([runOxlintAgentBatch(files), runTypeCheck()]);

  if (!lintOutput && !typeOutput) {
    return null;
  }

  return {
    decision: "block",
    reason: formatBlockReason(
      "❌ Ox check failed. Formatting was auto-applied but issues remain:",
      lintOutput,
      typeOutput,
    ),
  };
}

async function getStagedOxFiles(): Promise<string[]> {
  try {
    const { stdout } = await execAsync("git diff --cached --name-only --diff-filter=ACMR");
    const files = stdout
      .trim()
      .split("\n")
      .filter((f) => f && isOxFile(f));

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

export async function processPreToolUse(
  input: PreToolUseHookInput,
): Promise<SyncHookJSONOutput | null> {
  // The `Bash(git commit:*)` matcher only narrows which calls spawn this hook.
  // It fails open on shell metacharacters, and this path can return a `block`,
  // so the command is re-read here rather than trusted from the matcher.
  const { command } = input.tool_input as BashInput;
  if (!command || !invokesGitCommit(command)) {
    return null;
  }

  if (!(await hasOxTools())) {
    return null;
  }

  const files = await getStagedOxFiles();
  if (files.length === 0) {
    return null;
  }

  await runOxfmtWrite(files);

  const [lintOutput, typeOutput] = await Promise.all([runOxlintAgentBatch(files), runTypeCheck()]);

  if (!lintOutput && !typeOutput) {
    return null;
  }

  return {
    decision: "block",
    reason: formatBlockReason(
      "Ox found issues in staged files after auto-formatting:",
      lintOutput,
      typeOutput,
    ),
  };
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
      `[ox] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
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
