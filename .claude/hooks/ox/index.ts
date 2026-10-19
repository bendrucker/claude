#!/usr/bin/env bun

import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { decode, decodeStdin } from "../../../packages/decode/index";

// oxlint-disable-next-line typescript/strict-void-return -- tsc resolves promisify(execFile) through Node's [util.promisify.custom] overload correctly; a cast narrow enough to satisfy this rule trips typescript/no-unsafe-type-assertion instead.
const execFileAsync = promisify(execFile);

const OX_EXTENSIONS = new Set(["ts", "tsx", "js", "jsx", "json", "jsonc"]);

const FilePathInput = z.looseObject({ file_path: z.string().optional() });

export const HookInput = z.looseObject({
  hook_event_name: z.literal("PostToolUse"),
  tool_name: z.string(),
  tool_input: z.unknown(),
});

type HookInput = z.infer<typeof HookInput>;

const BinManifest = z.looseObject({
  bin: z.union([z.string(), z.record(z.string(), z.string())]).optional(),
});

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
  return OX_EXTENSIONS.has(getExtension(filePath));
}

// An argv array rather than a shell string, so a file path is never spliced
// into anything `/bin/sh` would parse. `prefix` carries the script argument
// when the binary runs through `bun`.
interface OxCommand {
  bin: string;
  prefix: string[];
}

// oxlint ships as a devDependency, so its binary lives in the module graph
// rather than on PATH (`bun run` adds node_modules/.bin, but direct hook
// invocation does not). The package's `exports` map does not declare its
// `bin/` entry as an importable subpath, so
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
    // A missing or malformed manifest must not fail the hook. Fall back to the caller's other lookup.
    return null;
  }
}

// A worktree nobody has installed into has no `node_modules` of its own. Bun's
// auto-install cache covers that on a warm machine, but a cold cache with no
// network leaves the resolve throwing and the pass silently off. The binaries
// are identical across worktrees of one repository, so fall back to the main
// checkout's copy rather than waiting on an install here.
async function binManifest(pkg: string): Promise<string | null> {
  try {
    return fileURLToPath(import.meta.resolve(`${pkg}/package.json`));
  } catch {
    const checkout = await mainCheckout();
    if (checkout == null) {
      return null;
    }
    const fallback = join(checkout, "node_modules", pkg, "package.json");
    return (await Bun.file(fallback).exists()) ? fallback : null;
  }
}

// --git-common-dir points at the main checkout's .git from inside any linked
// worktree, and at the current .git otherwise, so this resolves to the one
// checkout that installs are shared from.
async function mainCheckout(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      { cwd: import.meta.dirname },
    );
    const gitDir = stdout.trim();
    return gitDir !== "" ? dirname(gitDir) : null;
  } catch {
    // A missing git or a directory outside any repo must not fail the hook.
    return null;
  }
}

async function oxlintCommand(): Promise<OxCommand | null> {
  const local = await localBin("oxlint", "oxlint");
  if (local != null) {
    return { bin: "bun", prefix: [local] };
  }
  const global = Bun.which("oxlint");
  return global != null ? { bin: global, prefix: [] } : null;
}

// oxlint discovers the nearest ancestor config per file, so running from the
// file's own git toplevel lints a nested worktree against its own config.
async function oxWorkingTree(filePath: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
      cwd: dirname(filePath),
    });
    const root = stdout.trim();
    return root !== "" ? root : undefined;
  } catch {
    // Outside any repo, oxlint runs from the hook's cwd with its default config.
    return undefined;
  }
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

// --no-error-on-unmatched-pattern keeps oxlint from exiting non-zero on files
// its config ignores (gitignored paths, fixtures).
const LINT_ARGS = ["--no-error-on-unmatched-pattern", "-f", "agent"];

// Loading oxlint's JS plugin host costs a fixed ~150ms on top of a per-file
// pass, whatever rules it carries. A tree that keeps its JS-plugin rules in
// .oxlintrc.json and mirrors the rest into .oxlintrc.fast.json pays that only
// in the prek commit gate, which reads the default config. A tree without the
// file lints against its default config.
const FAST_CONFIG = ".oxlintrc.fast.json";

async function fastConfigArgs(cwd: string | undefined): Promise<string[]> {
  const path = join(cwd ?? process.cwd(), FAST_CONFIG);
  return (await Bun.file(path).exists()) ? ["-c", path] : [];
}

// The per-file pass runs without type information. tsgolint costs ~1s of CPU
// per run however small the file, and the prek gate's whole-tree type check
// reports the same rules before the session stops.
export async function runOxlintAgent(filePath: string): Promise<string | null> {
  const command = await oxlintCommand();
  if (!command) {
    return null;
  }
  const cwd = await oxWorkingTree(filePath);
  const args = [...command.prefix, ...(await fastConfigArgs(cwd)), ...LINT_ARGS, filePath];
  try {
    await execFileAsync(command.bin, args, cwd != null ? { cwd } : undefined);
    return null;
  } catch (error) {
    return commandOutput(error);
  }
}

// A file with a cascading error can report hundreds of lines on every edit, and
// each lands in context. The head carries the actionable ones.
export const POST_TOOL_USE_LINE_LIMIT = 40;

export function formatPostToolUseOutput(filePath: string, errors: string): SyncHookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: `⚠️ oxlint found issues in ${filePath}:\n\n${capped(errors)}\n\nThese will be checked again before the session ends.`,
    },
  };
}

function capped(errors: string): string {
  const diagnostics = errors.split("\n");
  if (diagnostics.length <= POST_TOOL_USE_LINE_LIMIT) {
    return errors;
  }
  const omitted = diagnostics.length - POST_TOOL_USE_LINE_LIMIT;
  return [
    ...diagnostics.slice(0, POST_TOOL_USE_LINE_LIMIT),
    `${omitted} more lines omitted. Run \`bun run check\` for the rest.`,
  ].join("\n");
}

export async function processPostToolUse(input: HookInput): Promise<SyncHookJSONOutput | null> {
  if (input.tool_name !== "Edit" && input.tool_name !== "Write") {
    return null;
  }

  const { file_path: filePath } = decode(FilePathInput, input.tool_input, "PostToolUse tool_input");
  if (filePath == null || filePath === "" || !isOxFile(filePath)) {
    return null;
  }

  const errors = await runOxlintAgent(filePath);
  return errors == null ? null : formatPostToolUseOutput(filePath, errors);
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

  const output = await processPostToolUse(input);
  if (output) {
    process.stdout.write(`${JSON.stringify(output)}\n`);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
