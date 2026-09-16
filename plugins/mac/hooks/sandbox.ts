#!/usr/bin/env bun

import { homedir } from "node:os";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";

// This hook gates every Bash call and cannot report a failure to load, so it
// narrows its input by hand and carries no runtime dependency. That rules out a
// shell parser package, so the tokenizer below is the grammar it can afford:
// quotes, escapes, separators, and the expansions that decide a path.
interface HookInput {
  cwd?: unknown;
  tool_input?: unknown;
}

interface CommandInput {
  command: string;
}

function hasCommand(toolInput: unknown): toolInput is CommandInput {
  if (toolInput == null || typeof toolInput !== "object") return false;
  if (!("command" in toolInput)) return false;
  return typeof toolInput.command === "string" && toolInput.command !== "";
}

function isPreToolUse(value: unknown): value is HookInput {
  if (value == null || typeof value !== "object") return false;
  return "hook_event_name" in value && value.hook_event_name === "PreToolUse";
}

const SCRIPT_INTERPRETERS = new Set(["bun", "node"]);
// Gating on extensions keeps the hook from reading the head of every binary it sees.
const SCRIPT_EXTENSIONS = new Set([".ts", ".js", ".mjs", ".cjs", ".sh"]);
// Words that stand ahead of the command they introduce, so the command's own
// name is the token past them.
const SEGMENT_PREFIXES = new Set(["do", "then", "else", "elif", "!", "time", "exec", "nohup"]);
const SEPARATORS = new Set([";", "\n", "&", "|", "(", ")"]);
const WHITESPACE = new Set([" ", "\t", "\r"]);
const ASSIGNMENT = /^([A-Za-z_]\w*)=([^]*)$/;
const EXPANSION = /\$\{(\w+)\}|\$(\w+)/g;
const SCRIPT_MARKER = "claude:dangerouslyDisableSandbox";

/**
 * Splits a command into the simple commands it runs, as token lists with quotes
 * removed.
 *
 * Newlines separate commands the way `;` does, which is what makes a `cd` on its
 * own line the whole story to a splitter that only knows operators. Quote state
 * carries across separators so a `;` or a newline inside an argument stays part
 * of that argument.
 */
export function tokenize(command: string): string[][] {
  const segments: string[][] = [];
  let tokens: string[] = [];
  let current = "";
  // A quoted empty string is a token; an empty buffer between spaces is not.
  let open = false;
  let quote: string | null = null;

  function endToken(): void {
    if (!open) return;
    tokens.push(current);
    current = "";
    open = false;
  }

  function endSegment(): void {
    endToken();
    if (tokens.length > 0) segments.push(tokens);
    tokens = [];
  }

  for (let index = 0; index < command.length; index++) {
    const char = command[index] ?? "";

    if (quote != null) {
      if (char === quote) quote = null;
      else {
        current += char;
        open = true;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      open = true;
    } else if (char === "\\" && index + 1 < command.length) {
      const escaped = command[++index] ?? "";
      // A backslash before a newline continues the same command.
      if (escaped !== "\n") {
        current += escaped;
        open = true;
      }
    } else if (SEPARATORS.has(char)) {
      // `&&` and `||` are one separator, so the pair is consumed together.
      if ((char === "&" || char === "|") && command[index + 1] === char) index++;
      endSegment();
    } else if (WHITESPACE.has(char)) {
      endToken();
    } else {
      current += char;
      open = true;
    }
  }

  endSegment();
  return segments;
}

function expand(value: string, variables: Map<string, string>): string {
  return value.replaceAll(EXPANSION, (source: string, braced?: string, bare?: string) => {
    const name = braced ?? bare ?? "";
    // An unresolved name stays as written, so it fails to open rather than
    // resolving to some other file.
    return variables.get(name) ?? process.env[name] ?? source;
  });
}

function expandHome(value: string): string {
  if (value === "~") return homedir();
  return value.startsWith("~/") ? join(homedir(), value.slice(2)) : value;
}

/** A path as the shell would reach it: expanded, and rooted at the command's own cwd. */
function resolvePath(value: string, cwd: string, variables: Map<string, string>): string {
  const expanded = expandHome(expand(value, variables));
  return isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
}

/**
 * The scripts a command runs, as absolute paths.
 *
 * `cwd` is where the command starts, which the tracked `cd`s then move: a
 * relative script path means nothing without it, and a command that changes
 * directory before running its script is the common shape.
 */
export function extractScripts(command: string, cwd: string): string[] {
  const variables = new Map<string, string>();
  const scripts: string[] = [];
  let directory = cwd;

  for (const tokens of tokenize(command)) {
    let index = 0;
    while (SEGMENT_PREFIXES.has(tokens[index] ?? "")) index++;

    // Assignments ahead of a command, and segments that are only assignments,
    // both name paths that a later `$VAR` resolves to.
    while (index < tokens.length) {
      const assignment = ASSIGNMENT.exec(tokens[index] ?? "");
      if (assignment == null) break;
      variables.set(assignment[1] ?? "", expand(assignment[2] ?? "", variables));
      index++;
    }

    const cmd = tokens[index];
    if (cmd == null || cmd === "") continue;

    const name = basename(cmd);
    if (name === "cd") {
      const target = tokens[index + 1];
      directory = target == null ? homedir() : resolvePath(target, directory, variables);
      continue;
    }

    if (SCRIPT_INTERPRETERS.has(name)) {
      const next = tokens[index + 1];
      if (next != null && next !== "" && !next.startsWith("-")) {
        scripts.push(resolvePath(next, directory, variables));
      }
    } else if (SCRIPT_EXTENSIONS.has(extname(name))) {
      scripts.push(resolvePath(cmd, directory, variables));
    }
  }

  return scripts;
}

async function readHead(path: string, length = 65536): Promise<Buffer | null> {
  try {
    const file = Bun.file(path);
    const slice = file.slice(0, length);
    return Buffer.from(await slice.arrayBuffer());
  } catch {
    return null;
  }
}

export async function hasBypassMarker(path: string): Promise<boolean> {
  const head = await readHead(path);
  return head ? head.includes(SCRIPT_MARKER) : false;
}

function disableSandbox(toolInput: CommandInput): SyncHookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      updatedInput: { ...toolInput, dangerouslyDisableSandbox: true },
    },
  };
}

export async function processInput(
  input: HookInput,
  platform = process.platform,
): Promise<SyncHookJSONOutput | null> {
  if (platform !== "darwin") return null;

  const toolInput = input.tool_input;
  if (!hasCommand(toolInput)) return null;

  // The session's cwd is where the command runs. The hook's own is only a
  // fallback, since Claude Code starts it from the project root either way.
  const cwd = typeof input.cwd === "string" && input.cwd !== "" ? input.cwd : process.cwd();

  for (const script of extractScripts(toolInput.command, cwd)) {
    // oxlint-disable-next-line no-await-in-loop -- first match wins: the scan stops at the first script carrying a bypass marker.
    if (await hasBypassMarker(script)) {
      return disableSandbox(toolInput);
    }
  }

  return null;
}

async function main(): Promise<void> {
  let input: unknown;
  try {
    input = JSON.parse(await Bun.stdin.text());
  } catch (error) {
    console.error(
      `[mac/sandbox] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  if (!isPreToolUse(input)) {
    console.error("[mac/sandbox] Hook input is not a PreToolUse event");
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
