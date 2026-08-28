#!/usr/bin/env bun

import { execFile } from "node:child_process";
import { readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { decode, decodeJson, decodeStdin } from "../../../packages/decode/index";

const execFileAsync = promisify(execFile);

const OX_EXTENSIONS = new Set(["ts", "tsx", "js", "jsx", "json", "jsonc"]);

const FilePathInput = z.looseObject({ file_path: z.string().optional() });
const BashInput = z.looseObject({ command: z.string().optional() });

const PreToolUseInput = z.looseObject({
  hook_event_name: z.literal("PreToolUse"),
  tool_input: z.unknown(),
});

const PostToolUseInput = z.looseObject({
  hook_event_name: z.literal("PostToolUse"),
  tool_name: z.string(),
  tool_input: z.unknown(),
});

const StopInput = z.looseObject({
  hook_event_name: z.literal("Stop"),
  session_id: z.string(),
  transcript_path: z.string(),
  stop_hook_active: z.boolean().optional(),
});

export const HookInput = z.discriminatedUnion("hook_event_name", [
  PreToolUseInput,
  PostToolUseInput,
  StopInput,
]);

type PreToolUseInput = z.infer<typeof PreToolUseInput>;
type PostToolUseInput = z.infer<typeof PostToolUseInput>;
type StopInput = z.infer<typeof StopInput>;
type HookInput = z.infer<typeof HookInput>;

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

const ContentBlock = z.looseObject({
  type: z.string(),
  name: z.string().optional(),
  input: FilePathInput.optional(),
});

const TranscriptEntry = z.looseObject({
  type: z.string().optional(),
  message: z
    .looseObject({ content: z.union([z.string(), z.array(ContentBlock)]).optional() })
    .optional(),
});

const BinManifest = z.looseObject({
  bin: z.union([z.string(), z.record(z.string(), z.string())]).optional(),
});

const BlockState = z.looseObject({ blocks: z.number().optional() });

const CommandFailure = z.looseObject({
  stdout: z.string().optional(),
  stderr: z.string().optional(),
});

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
  const manifestPath = await binManifest(pkg);
  if (manifestPath == null) {
    return null;
  }
  try {
    const manifest = decode(BinManifest, await Bun.file(manifestPath).json(), manifestPath);
    const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.[binName];
    return bin != null && bin !== "" ? join(dirname(manifestPath), bin) : null;
  } catch {
    return null;
  }
}

// A worktree nobody has installed into has no `node_modules` of its own. Bun's
// auto-install cache covers that on a warm machine, but a cold cache with no
// network leaves the resolve throwing and every gate silently off. The binaries
// are identical across worktrees of one repository, so fall back to the main
// checkout's copy rather than making the gates wait on an install here.
async function binManifest(pkg: string): Promise<string | null> {
  try {
    return fileURLToPath(import.meta.resolve(`${pkg}/package.json`));
  } catch {
    const checkout = await mainCheckout();
    if (checkout == null) {
      return null;
    }
    const fallback = join(checkout, "node_modules", pkg, "package.json");
    return (await fileExists(fallback)) ? fallback : null;
  }
}

let mainCheckoutPromise: Promise<string | null> | undefined;

// --git-common-dir points at the main checkout's .git from inside any linked
// worktree, and at the current .git otherwise, so this resolves to the one
// checkout that installs are shared from.
function mainCheckout(): Promise<string | null> {
  mainCheckoutPromise ??= (async () => {
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["rev-parse", "--path-format=absolute", "--git-common-dir"],
        { cwd: import.meta.dirname },
      );
      const gitDir = stdout.trim();
      return gitDir !== "" ? dirname(gitDir) : null;
    } catch {
      return null;
    }
  })();
  return mainCheckoutPromise;
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
  const global = local == null ? Bun.which(binName) : null;
  const resolved =
    local != null
      ? { bin: "bun", prefix: [local] }
      : global != null
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
    await execFileAsync(
      command.bin,
      [...command.prefix, ...args],
      cwd != null && cwd !== "" ? { cwd } : undefined,
    );
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
    if (line.trim() === "") continue;

    try {
      const entry = decodeJson(TranscriptEntry, line, transcriptPath);
      const blocks = entry.message?.content;
      if (entry.type !== "assistant" || !Array.isArray(blocks)) continue;

      for (const block of blocks) {
        if (block.type !== "tool_use") continue;
        if (block.name !== "Edit" && block.name !== "Write") continue;

        const filePath = block.input?.file_path;
        if (filePath != null && filePath !== "" && isOxFile(filePath)) {
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
    const root = stdout.trim();
    toplevel = root !== "" ? root : undefined;
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
  const failure = CommandFailure.safeParse(error);
  if (!failure.success) return null;
  const output = [failure.data.stdout, failure.data.stderr]
    .map((stream) => stream?.trim())
    .filter(Boolean)
    .join("\n");
  return output !== "" ? output : null;
}

// --no-error-on-unmatched-pattern keeps oxlint/oxfmt from exiting non-zero on
// files their config ignores (gitignored paths, fixtures). Without it, edits
// to excluded files read as lint or format failures and block Stop.
const LINT_ARGS = ["--no-error-on-unmatched-pattern", "-f", "agent"];

// Only the per-file pass runs type-aware. The gate below pairs its batch with a
// whole-tree --type-aware --type-check that reports the same rules, so asking
// for them twice buys nothing and costs the gate a second type-aware run.
//
// --type-aware in a tree tsgolint cannot resolve reports the missing executable
// instead of linting, and no edit clears that. `installed` skips the doomed run
// where node_modules is absent. A tree carrying node_modules without the checker
// shows up only in the diagnostics, so the plain pass runs as a fallback to
// recover the findings that need no type information.
async function runOxlintPass(
  command: OxCommand,
  args: string[],
  cwd: string | undefined,
): Promise<string | null> {
  if (!(await installed(cwd))) {
    return runOx(command, args, cwd);
  }
  const output = await runOx(command, ["--type-aware", ...args], cwd);
  return output != null && MISSING_CHECKER.test(output) ? runOx(command, args, cwd) : output;
}

export async function runOxlintAgent(filePath: string): Promise<string | null> {
  const command = await oxlintCommand();
  if (!command) {
    return null;
  }
  const cwd = await oxWorkingTree(filePath);
  return runOxlintPass(command, [...LINT_ARGS, filePath], cwd);
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
  const combined = outputs.filter((output): output is string => output != null).join("\n");
  return combined !== "" ? combined : null;
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

// A checkout nobody has installed into has neither the tsgolint binary nor the
// dependency type declarations tsgolint resolves imports against, so it reports
// a missing executable, or every external import as missing plus the
// implicit-any cascade that follows. Those diagnostics describe the
// environment, and no edit the session can make will clear them, so the type
// section is dropped instead of blocking. The presence of `node_modules`
// decides it rather than the diagnostics themselves, so one typo'd package name
// in an installed tree cannot silence the whole gate.
const MISSING_CHECKER = /Failed to find tsgolint executable/;

async function installed(cwd: string | undefined): Promise<boolean> {
  try {
    await readdir(join(cwd ?? process.cwd(), "node_modules"));
    return true;
  } catch {
    return false;
  }
}

type TypeCheckResult = { output: string | null; needsInstall: boolean };

// There is no useful per-file mode, so this runs whole-tree, once per working
// tree the gated files resolve to. --quiet drops warnings: whole-tree they run
// to dozens of lines the turn did not cause, and the batch lint pass above
// already reports them for the files actually edited. --no-error-on-unmatched-pattern
// covers a tree whose config ignores everything in it, which otherwise exits
// non-zero with "No files found to lint" and reads as a type failure.
const TYPE_CHECK_ARGS = [
  "--type-aware",
  "--type-check",
  "--quiet",
  "--no-error-on-unmatched-pattern",
  "-f",
  "agent",
];

async function runTypeCheck(files: string[]): Promise<TypeCheckResult> {
  const command = await oxlintCommand();
  if (!command || files.length === 0) {
    return { output: null, needsInstall: false };
  }
  const groups = await groupByWorkingTree(files);
  const results = await Promise.all(
    [...groups.keys()].map(async (cwd) => {
      if (!(await installed(cwd))) {
        return { output: null, needsInstall: true };
      }
      const output = await runOx(command, TYPE_CHECK_ARGS, cwd);
      return output != null && MISSING_CHECKER.test(output)
        ? { output: null, needsInstall: true }
        : { output, needsInstall: false };
    }),
  );

  const combined = results
    .map((result) => result.output)
    .filter((output): output is string => output != null)
    .join("\n");
  return {
    output: combined !== "" ? combined : null,
    needsInstall: results.some((result) => result.needsInstall),
  };
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
  if (lintOutput == null) {
    return typeOutput;
  }
  const reported = new Set(lintOutput.split("\n"));
  return typeOutput
    .split("\n")
    .filter((line) => !reported.has(line))
    .join("\n");
}

function formatSections(lintOutput: string | null, typeCheck: TypeCheckResult): string {
  const sections = [];
  if (lintOutput != null) sections.push(`Lint:\n${lintOutput}`);
  const types = typeCheck.output != null ? withoutRepeats(typeCheck.output, lintOutput) : "";
  if (types !== "") sections.push(`Types:\n${types}`);
  if (typeCheck.needsInstall) {
    sections.push("Types: skipped, dependencies are not installed here (`bun install`).");
  }
  return sections.join("\n\n");
}

// The gate Stop and the pre-commit check share: reformat first so the lint pass
// sees final text, then lint and type-check concurrently. Only oxlint is
// required, so a missing oxfmt degrades to checking without reformatting. The
// diagnostics come back unframed: the two callers say different things about
// them, and Stop says two different things itself depending on whether it is
// still willing to block.
async function runOxGate(files: string[]): Promise<string | null> {
  if (files.length === 0) {
    return null;
  }

  await runOxfmtWrite(files);

  const [lintOutput, typeCheck] = await Promise.all([
    runOxlintAgentBatch(files),
    runTypeCheck(files),
  ]);
  if (lintOutput == null && typeCheck.output == null) {
    return null;
  }

  return formatSections(lintOutput, typeCheck);
}

export async function processPostToolUse(
  input: PostToolUseInput,
): Promise<SyncHookJSONOutput | null> {
  const toolName = input.tool_name;
  if (toolName !== "Edit" && toolName !== "Write") {
    return null;
  }

  const { file_path: filePath } = decode(FilePathInput, input.tool_input, "PostToolUse tool_input");
  if (filePath == null || filePath === "" || !isOxFile(filePath)) {
    return null;
  }

  if (!(await oxlintCommand())) {
    return null;
  }

  const errors = await runOxlintAgent(filePath);
  if (errors == null) {
    return null;
  }

  return formatPostToolUseOutput(filePath, errors);
}

// A blocked Stop wakes the model to repair, and the Stop that follows carries
// stop_hook_active. Returning null there ends the session on text the gate never
// saw: the repair can leave the original error standing, or introduce a
// cross-file type error the per-edit lint pass cannot reach. So the re-entrant
// Stop checks too, and a count of consecutive blocks bounds it, since an error
// the model cannot clear would otherwise block every Stop forever.
export const STOP_BLOCK_LIMIT = 2;

const UNSAFE_SESSION = /[^A-Za-z0-9._-]+/g;

export function blockCountPath(sessionId: string): string {
  return join(tmpdir(), "claude-ox-gate", `${sessionId.replace(UNSAFE_SESSION, "-")}.json`);
}

async function priorBlocks(sessionId: string): Promise<number> {
  try {
    const path = blockCountPath(sessionId);
    return decode(BlockState, await Bun.file(path).json(), path).blocks ?? 0;
  } catch {
    return 0;
  }
}

async function recordBlocks(sessionId: string, blocks: number): Promise<boolean> {
  try {
    await Bun.write(blockCountPath(sessionId), JSON.stringify({ blocks }));
    return true;
  } catch {
    return false;
  }
}

async function clearBlocks(sessionId: string): Promise<void> {
  try {
    await rm(blockCountPath(sessionId), { force: true });
  } catch {}
}

export async function processStop(input: StopInput): Promise<SyncHookJSONOutput | null> {
  // Every exit that is not a block clears the count, so a stale one can never
  // be read back as progress through a later round's budget.
  if (!(await oxlintCommand())) {
    await clearBlocks(input.session_id);
    return null;
  }

  const sections = await runOxGate(await parseTranscript(input.transcript_path));
  if (sections == null || sections === "") {
    await clearBlocks(input.session_id);
    return null;
  }

  // A Stop the model did not arrive at through a block starts a fresh round.
  const blocked = input.stop_hook_active ? await priorBlocks(input.session_id) : 0;

  // Blocking is only safe once the count that will later release it is on disk.
  // A state file that cannot be written would otherwise leave every re-entrant
  // Stop reading zero and blocking again, forever.
  if (blocked < STOP_BLOCK_LIMIT && (await recordBlocks(input.session_id, blocked + 1))) {
    return {
      decision: "block",
      reason: `❌ Ox check failed. Formatting was auto-applied but issues remain:\n\n${sections}\n\nFix these issues before stopping.`,
    };
  }

  await clearBlocks(input.session_id);
  return {
    systemMessage: `⚠️ Ox is no longer blocking on these issues, so this stop goes through with them in place:\n\n${sections}`,
  };
}

type StagedOxFiles = { paths: string[]; diverged: string[] };

// The gate checks and reformats working-tree files while the commit records the
// index. A staged file carrying further unstaged edits makes those two
// different texts, so a pass would clear content oxlint never saw and a block
// would name content git is not about to commit. Those files come back as
// `diverged` for the caller to refuse on.
async function getStagedOxFiles(): Promise<StagedOxFiles> {
  try {
    const [staged, unstaged] = await Promise.all([
      execFileAsync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR"]),
      execFileAsync("git", ["diff", "--name-only"]),
    ]);

    const names = lines(staged.stdout).filter(isOxFile);
    const modified = new Set(lines(unstaged.stdout));
    const diverged = names.filter((name) => modified.has(name));

    const cwd = process.cwd();
    const existChecks = names.map(async (f) => {
      const fullPath = f.startsWith("/") ? f : `${cwd}/${f}`;
      return { path: fullPath, exists: await fileExists(fullPath) };
    });

    const results = await Promise.all(existChecks);
    return { paths: results.filter((r) => r.exists).map((r) => r.path), diverged };
  } catch {
    return { paths: [], diverged: [] };
  }
}

function lines(stdout: string): string[] {
  return stdout.trim().split("\n").filter(Boolean);
}

export async function processPreToolUse(
  input: PreToolUseInput,
): Promise<SyncHookJSONOutput | null> {
  // The `Bash(git commit:*)` matcher only narrows which calls spawn this hook.
  // It fails open on shell metacharacters, and this path can return a `block`,
  // so the command is re-read here rather than trusted from the matcher.
  const { command } = decode(BashInput, input.tool_input, "PreToolUse tool_input");
  if (command == null || command === "" || !invokesGitCommit(command)) {
    return null;
  }

  if (!(await oxlintCommand())) {
    return null;
  }

  const staged = await getStagedOxFiles();
  if (staged.diverged.length > 0) {
    return deny(
      `These files are staged with further unstaged edits, so the commit would record text this check never saw:\n\n${staged.diverged
        .map((f) => `  ${f}`)
        .join("\n")}\n\nStage or stash the working-tree changes, then commit.`,
    );
  }

  const sections = await runOxGate(staged.paths);
  await restage(staged.paths);
  if (sections == null || sections === "") {
    return null;
  }
  return deny(
    `Ox found issues in staged files after auto-formatting:\n\n${sections}\n\nFix these issues before committing.`,
  );
}

// The gate reformats on disk, which would otherwise leave the index holding the
// unformatted text the commit is about to record. The divergence check above
// established that the two already matched, so re-adding carries the formatting
// and nothing the user had not staged.
async function restage(paths: string[]): Promise<void> {
  if (paths.length === 0) {
    return;
  }
  try {
    await execFileAsync("git", ["add", "--", ...paths]);
  } catch {
    return;
  }
}

function deny(reason: string): SyncHookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

export async function processInput(input: HookInput): Promise<SyncHookJSONOutput | null> {
  if (input.hook_event_name === "PreToolUse") {
    return processPreToolUse(input);
  }
  if (input.hook_event_name === "PostToolUse") {
    return processPostToolUse(input);
  }
  return processStop(input);
}

async function main(): Promise<void> {
  let input: HookInput;
  try {
    input = await decodeStdin(HookInput, "ox hook input");
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
