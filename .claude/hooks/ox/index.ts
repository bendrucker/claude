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

// An argv array rather than a shell string, so a file path is never spliced
// into anything `/bin/sh` would parse. `prefix` carries the script argument
// when the binary runs through `bun`.
type OxCommand = { bin: string; prefix: string[] };

// oxlint and oxfmt ship as devDependencies, so their binaries live in the
// module graph rather than on PATH (`bun run` adds node_modules/.bin, but
// `bun test` and direct hook invocation do not). Neither package's `exports`
// map declares its `bin/` entry as an importable subpath, so
// `import.meta.resolve("oxlint/bin/oxlint")` throws even when the package is
// installed. `package.json` is exported, so resolve that instead and rejoin
// its directory with the `bin` path the manifest itself declares.
async function localBin(pkg: string, binName: string): Promise<string | null> {
  try {
    const manifestPath = fileURLToPath(import.meta.resolve(`${pkg}/package.json`));
    const manifest = (await Bun.file(manifestPath).json()) as {
      bin?: string | Record<string, string>;
    };
    const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.[binName];
    return bin ? join(dirname(manifestPath), bin) : null;
  } catch {
    return null;
  }
}

// A single Stop asks for oxlint three times and oxfmt twice. Resolution cannot
// change within one hook invocation, so it happens once per process.
const commandCache = new Map<string, OxCommand | null>();

async function resolveCommand(pkg: string, binName: string): Promise<OxCommand | null> {
  const cached = commandCache.get(pkg);
  if (cached !== undefined) {
    return cached;
  }
  const local = await localBin(pkg, binName);
  const global = local ? null : Bun.which(binName);
  const resolved = local
    ? { bin: "bun", prefix: [local] }
    : global
      ? { bin: global, prefix: [] }
      : null;
  commandCache.set(pkg, resolved);
  return resolved;
}

async function oxlintCommand(): Promise<OxCommand | null> {
  return resolveCommand("oxlint", "oxlint");
}

async function oxfmtCommand(): Promise<OxCommand | null> {
  return resolveCommand("oxfmt", "oxfmt");
}

async function runOx(
  command: OxCommand,
  args: string[],
  cwd: string | undefined,
): Promise<string | null> {
  try {
    await execFileAsync(command.bin, [...command.prefix, ...args], cwd ? { cwd } : undefined);
    return null;
  } catch (error) {
    return commandOutput(error);
  }
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

// Keyed by directory: a turn's files usually share one, and the answer cannot
// change while the hook runs.
const workingTreeCache = new Map<string, string | undefined>();

// oxlint and oxfmt both discover the nearest ancestor config per file they
// process, so resolving cwd per file lets them lint and format a nested git
// worktree correctly even when invoked from an ancestor directory. This also
// keeps relative paths and any future tool-relative resolution anchored to
// the file's own working tree.
async function oxWorkingTree(filePath: string): Promise<string | undefined> {
  const dir = dirname(filePath);
  if (workingTreeCache.has(dir)) {
    return workingTreeCache.get(dir);
  }
  let toplevel: string | undefined;
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd: dir });
    toplevel = stdout.trim() || undefined;
  } catch {
    toplevel = undefined;
  }
  workingTreeCache.set(dir, toplevel);
  return toplevel;
}

// Splits files by resolved working tree so a turn touching a single worktree
// (the common case) becomes one batched process, while a turn spanning a
// nested worktree still runs each group from the cwd that governs it.
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

function commandOutput(error: unknown): string | null {
  const { stdout, stderr } = error as { stdout?: string; stderr?: string };
  const output = [stdout, stderr]
    .map((stream) => stream?.trim())
    .filter(Boolean)
    .join("\n");
  return output || null;
}

// --no-error-on-unmatched-pattern keeps oxlint/oxfmt from exiting non-zero on
// files their config ignores (gitignored paths, fixtures). Without it, edits
// to excluded files read as lint or format failures and block Stop.
const LINT_ARGS = ["--no-error-on-unmatched-pattern", "-f", "agent"];

export async function runOxlintAgent(filePath: string): Promise<string | null> {
  const command = await oxlintCommand();
  if (!command) {
    return null;
  }
  return runOx(command, [...LINT_ARGS, filePath], await oxWorkingTree(filePath));
}

async function runOxlintAgentBatch(files: string[]): Promise<string | null> {
  const command = await oxlintCommand();
  if (!command || files.length === 0) {
    return null;
  }
  const groups = await groupByWorkingTree(files);
  const outputs = await Promise.all(
    [...groups.entries()].map(([cwd, groupFiles]) =>
      runOx(command, [...LINT_ARGS, ...groupFiles], cwd),
    ),
  );
  const combined = outputs.filter((output): output is string => Boolean(output)).join("\n");
  return combined || null;
}

// oxfmt --write exits non-zero when a file has a syntax error it cannot
// format. The follow-up oxlint pass surfaces that separately, so its output is
// discarded here rather than blocking on it twice.
async function runOxfmtWrite(files: string[]): Promise<void> {
  const command = await oxfmtCommand();
  if (!command || files.length === 0) {
    return;
  }
  const groups = await groupByWorkingTree(files);
  await Promise.all(
    [...groups.entries()].map(([cwd, groupFiles]) =>
      runOx(command, ["--write", "--no-error-on-unmatched-pattern", ...groupFiles], cwd),
    ),
  );
}

// Type-aware lint rules stay off in .oxlintrc.json; --type-aware is enabled
// only because --type-check requires the same type-info plumbing. There is no
// useful per-file mode, so this always runs repo-wide. --quiet drops warnings:
// repo-wide they run to dozens of lines the turn did not cause, and the batch
// lint pass above already reports them for the files actually edited.
async function runTypeCheck(): Promise<string | null> {
  const command = await oxlintCommand();
  if (!command) {
    return null;
  }
  return runOx(command, ["--type-aware", "--type-check", "--quiet", "-f", "agent"], undefined);
}

function formatPostToolUseOutput(filePath: string, errors: string): SyncHookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: `⚠️ oxlint found issues in ${filePath}:\n\n${errors}\n\nThese will be checked again before the session ends.`,
    },
  };
}

// The type-check run reports lint errors alongside TypeScript diagnostics and
// there is no flag to narrow it, so drop the lines the scoped lint pass already
// reported rather than showing each one twice.
function withoutRepeats(typeOutput: string, lintOutput: string | null): string {
  if (!lintOutput) {
    return typeOutput;
  }
  const reported = new Set(lintOutput.split("\n"));
  return typeOutput
    .split("\n")
    .filter((line) => !reported.has(line))
    .join("\n");
}

function formatBlockReason(
  intro: string,
  verb: string,
  lintOutput: string | null,
  typeOutput: string | null,
): string {
  const sections = [];
  if (lintOutput) sections.push(`Lint:\n${lintOutput}`);
  const types = typeOutput && withoutRepeats(typeOutput, lintOutput);
  if (types) sections.push(`Types:\n${types}`);
  return `${intro}\n\n${sections.join("\n\n")}\n\nFix these issues before ${verb}.`;
}

// The gate Stop and the pre-commit check share: reformat first so the lint pass
// sees final text, then lint and type-check concurrently. Only oxlint is
// required, so a missing oxfmt degrades to checking without reformatting rather
// than dropping the gate entirely.
async function runOxGate(
  files: string[],
  intro: string,
  verb: string,
): Promise<SyncHookJSONOutput | null> {
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
    reason: formatBlockReason(intro, verb, lintOutput, typeOutput),
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

  if (!(await oxlintCommand())) {
    return null;
  }

  return runOxGate(
    await parseTranscript(input.transcript_path),
    "❌ Ox check failed. Formatting was auto-applied but issues remain:",
    "stopping",
  );
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

  if (!(await oxlintCommand())) {
    return null;
  }

  return runOxGate(
    await getStagedOxFiles(),
    "Ox found issues in staged files after auto-formatting:",
    "committing",
  );
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
