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
const SEGMENT_PREFIXES = new Set(["do", "then", "else", "elif", "!", "time", "exec", "nohup", "{"]);
// `run` stands between an interpreter and its script the way a flag does.
const INTERPRETER_PREFIXES = new Set(["run"]);
const SEPARATORS = new Set([";", "\n", "&", "|", "(", ")"]);
const WHITESPACE = new Set([" ", "\t", "\r"]);
// A backslash stays literal in double quotes unless it precedes one of these characters.
const DOUBLE_QUOTED_ESCAPES = new Set(["$", "`", '"', "\\", "\n"]);
const ASSIGNMENT = /^([A-Za-z_]\w*)=([^]*)$/;
const EXPANSION = /\$\{(\w+)\}|\$(\w+)/g;
const SCRIPT_MARKER = "claude:dangerouslyDisableSandbox";

/** One run of a token's text. Single quotes and a backslash suppress expansion. */
interface TokenPart {
  text: string;
  expands: boolean;
}

/** One argument, split where its quoting changes. */
export type Token = TokenPart[];

export interface Segment {
  tokens: Token[];
  /** Subshell nesting, so a `cd` inside `( … )` does not outlive it. */
  depth: number;
}

export function tokenText(token: Token): string {
  return token.map((part) => part.text).join("");
}

/**
 * Splits a command into the simple commands it runs, as tokens carrying where
 * their text came from.
 *
 * Newlines separate commands the way `;` does, which is what makes a `cd` on its
 * own line the whole story to a splitter that only knows operators. Quote state
 * carries across separators so a `;` or a newline inside an argument stays part
 * of that argument.
 */
export function tokenize(command: string): Segment[] {
  const segments: Segment[] = [];
  let depth = 0;
  let tokens: Token[] = [];
  let parts: TokenPart[] = [];
  let current = "";
  let expands = true;
  // A quoted empty string is a token; an empty buffer between spaces is not.
  let open = false;
  let quote: string | null = null;
  // Delimiters of the heredocs opened on the line being read, in the order the
  // shell will consume their bodies once that line ends.
  let pending: string[] = [];

  function endPart(next: boolean): void {
    if (current !== "") parts.push({ text: current, expands });
    current = "";
    expands = next;
  }

  function endToken(): void {
    endPart(true);
    if (!open) return;
    tokens.push(parts);
    parts = [];
    open = false;
  }

  function endSegment(): void {
    endToken();
    if (tokens.length > 0) segments.push({ tokens, depth });
    tokens = [];
  }

  /** The word after `<<`, unquoted, or null where no heredoc opens there. */
  function readDelimiter(start: number): { delimiter: string; next: number } | null {
    let cursor = command[start] === "-" ? start + 1 : start;
    while (WHITESPACE.has(command[cursor] ?? "")) cursor++;
    let delimiter = "";
    let mark: string | null = null;
    for (; cursor < command.length; cursor++) {
      const char = command[cursor] ?? "";
      if (mark != null) {
        if (char === mark) mark = null;
        else delimiter += char;
      } else if (char === "'" || char === '"') mark = char;
      else if (char === "\\") delimiter += command[++cursor] ?? "";
      else if (WHITESPACE.has(char) || SEPARATORS.has(char)) break;
      else delimiter += char;
    }
    return delimiter === "" ? null : { delimiter, next: cursor };
  }

  /**
   * Walks past the bodies of the heredocs this line opened, ending at the last
   * delimiter line. The body is data the shell hands to a command, so a script
   * named in it never runs and never grants a bypass.
   */
  function skipBodies(newline: number): number {
    let cursor = newline;
    for (const delimiter of pending) {
      while (cursor < command.length) {
        const end = command.indexOf("\n", cursor + 1);
        const line = command.slice(cursor + 1, end === -1 ? command.length : end);
        cursor = end === -1 ? command.length : end;
        if (line.trim() === delimiter) break;
      }
    }
    pending = [];
    return cursor;
  }

  for (let index = 0; index < command.length; index++) {
    const char = command[index] ?? "";

    if (quote != null) {
      if (quote === '"' && char === "\\" && DOUBLE_QUOTED_ESCAPES.has(command[index + 1] ?? "")) {
        const escaped = command[++index] ?? "";
        if (escaped !== "\n") {
          endPart(false);
          current += escaped;
          endPart(true);
        }
        open = true;
      } else if (char === quote) {
        endPart(true);
        quote = null;
      } else {
        current += char;
        open = true;
      }
      continue;
    }

    // `#` opens a comment only where a word would start, so the rest of the line
    // is text the shell never runs.
    if (char === "#" && !open) {
      const end = command.indexOf("\n", index);
      if (end === -1) break;
      index = end - 1;
      continue;
    }

    if (char === "'" || char === '"') {
      endPart(char === '"');
      quote = char;
      open = true;
    } else if (char === "\\" && index + 1 < command.length) {
      const escaped = command[++index] ?? "";
      // A backslash before a newline continues the same command.
      if (escaped !== "\n") {
        endPart(false);
        current += escaped;
        endPart(true);
        open = true;
      }
    } else if (char === "<" && command[index + 1] === "<" && command[index + 2] !== "<") {
      // `<<<` is a here-string, which carries no body.
      const heredoc = readDelimiter(index + 2);
      if (heredoc === null) {
        current += char;
        open = true;
      } else {
        endToken();
        pending.push(heredoc.delimiter);
        index = heredoc.next - 1;
      }
    } else if (SEPARATORS.has(char)) {
      // `&&` and `||` are one separator, so the pair is consumed together.
      if ((char === "&" || char === "|") && command[index + 1] === char) index++;
      endSegment();
      if (char === "\n" && pending.length > 0) index = skipBodies(index);
      else if (char === "(") depth++;
      else if (char === ")") depth = Math.max(0, depth - 1);
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

function expandToken(token: Token, variables: Map<string, string>): string {
  return token.map((part) => (part.expands ? expand(part.text, variables) : part.text)).join("");
}

function resolvePath(token: Token, cwd: string, variables: Map<string, string>): string {
  const expanded = expandToken(token, variables);
  // `~` is a path only unquoted.
  const value = token[0]?.expands === true ? expandHome(expanded) : expanded;
  return isAbsolute(value) ? value : resolve(cwd, value);
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
  // One directory per subshell level, so a `cd` unwinds with the `)` that ends it.
  const directories = [cwd];
  let previous = cwd;

  for (const { tokens, depth } of tokenize(command)) {
    while (directories.length > depth + 1) directories.pop();
    while (directories.length <= depth) directories.push(directories.at(-1) ?? cwd);
    const directory = directories.at(-1) ?? cwd;

    let index = 0;
    while (SEGMENT_PREFIXES.has(tokenText(tokens[index] ?? []))) index++;

    const assignments = new Map<string, string>();
    while (index < tokens.length) {
      const token = tokens[index] ?? [];
      const name = ASSIGNMENT.exec(tokenText(token))?.[1];
      if (name == null) break;
      assignments.set(name, expandToken(token, variables).slice(name.length + 1));
      index++;
    }

    const cmd = tokens[index];
    // A segment of assignments alone sets them for the rest of the shell. Ahead
    // of a command they last only for it, so a later `$VAR` must not see them.
    if (cmd === undefined) {
      for (const [name, value] of assignments) variables.set(name, value);
      continue;
    }

    const scoped = new Map([...variables, ...assignments]);
    const executable = expandToken(cmd, scoped);
    if (executable === "") continue;

    const name = basename(executable);
    if (name === "cd") {
      const target = tokens[index + 1];
      const argument = target === undefined ? "" : expandToken(target, scoped);
      let next: string;
      if (argument === "") {
        next = homedir();
      } else if (argument === "-") {
        next = previous;
      } else {
        next = resolvePath(target ?? [], directory, scoped);
      }
      previous = directory;
      directories[directories.length - 1] = next;
      continue;
    }

    if (SCRIPT_INTERPRETERS.has(name)) {
      let argument = index + 1;
      while (argument < tokens.length) {
        const text = expandToken(tokens[argument] ?? [], scoped);
        if (text !== "" && !text.startsWith("-") && !INTERPRETER_PREFIXES.has(text)) break;
        argument++;
      }
      const script = tokens[argument];
      if (script !== undefined) scripts.push(resolvePath(script, directory, scoped));
    } else if (SCRIPT_EXTENSIONS.has(extname(name))) {
      scripts.push(resolvePath(cmd, directory, scoped));
    }
  }

  return scripts;
}

async function readHead(path: string, length = 65536): Promise<Buffer | null> {
  try {
    const file = Bun.file(path);
    // A directory, a device, or a FIFO at this path would read as garbage or
    // block the hook forever, so only a regular file is opened.
    if (!(await file.stat()).isFile()) return null;
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
  const cwd = typeof input.cwd === "string" && isAbsolute(input.cwd) ? input.cwd : process.cwd();

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
