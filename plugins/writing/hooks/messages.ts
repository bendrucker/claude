import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { stripCode } from "../detection/code-spans";
import { valeAlerts } from "../detection/vale";
import { toolInputOf } from "./io";
import { decisionOf, hookAlertOf, type HookAlert } from "./report";
import { parseShell, type ShellArg, type ShellCommand } from "./shell";

// The full set of Bash prose surfaces this hook scans. The hooks.json Bash
// guard is derived from these. hooks.test.ts enforces the sync.
export const PROSE_FLAGS = ["--body", "--message", "--description", "--title"] as const;
// `--body-file path` names the file a CLI reads the `--body` value from.
export const BODY_FILE_FLAGS = PROSE_FLAGS.map((flag) => `${flag}-file`);
// Short forms are read only on a review command, where they cannot mean something else.
const REVIEW_SHORT_FLAGS = ["-m", "-b"] as const;

// An API CLI reads a field's value from a file in the `-F key=@file` form. The
// guard fragment ships to hooks.json verbatim, and hooks.test.ts enforces the sync.
export const FIELD_FILE_GUARD = "(-F|--field)[= ][^ ]*=@";

// git commit / git tag read their message from a file via -F / --file, with no
// `key=@` marker. Scoped to git so a bare `-F` in unrelated CLIs (curl) does
// not trigger file reads. Guard fragment shipped to hooks.json like the above.
export const GIT_MESSAGE_FILE_GUARD = "git (commit|tag).* (-F|--file)[= ]";

// A review command reads a JSON payload of comments from `--input <file>`.
// Guard fragment shipped to hooks.json like the above.
export const INPUT_FILE_GUARD = "--input[= ]";

// A review command can read its body from stdin or a short flag. hooks.json
// greps for this fragment too.
export const REVIEW_STDIN_GUARD = "(review|note|discussion)[^|;&]*( <|-m |-b )";

// Any prose value in an MCP call puts three spaces, backticks, or JSON-escaped
// tabs on the hook's stdin, since a stripped code span reads as spaces.
// hooks.json ships this grep so other calls skip the bun spawn.
export const MCP_PROSE_GUARD = "([ `]|\\\\t).*([ `]|\\\\t).*([ `]|\\\\t)";

const PROSE_WORD = /^[("'*_]*(?:[A-Za-z][A-Za-z'’-]*|\d[\d,.%]*)[)"'*_.,;:!?]*$/;
const MIN_SENTENCE_TOKENS = 4;
const MIN_WORD_SHARE = 0.8;

export function isProse(value: string): boolean {
  // A sentence that ends on a code span keeps its terminator.
  const text = stripCode(value).replaceAll(/[ \t]+([.!?:])/g, "$1");
  for (const sentence of text.split(/(?<=\w[.!?])\s+|\n+/)) {
    const trimmed = sentence.trim();
    const tokens = trimmed.split(/[ \t]+/);
    if (tokens.length < MIN_SENTENCE_TOKENS || !/[\w)"'’*][.!?:][)"'’*_]*$/.test(trimmed)) continue;
    const words = tokens.filter((token) => PROSE_WORD.test(token)).length;
    if (words / tokens.length >= MIN_WORD_SHARE) return true;
  }
  return false;
}

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

// `review`, `note`, or `discussion`, alone or plural, as a whole word or a
// segment of a path, script name, or API endpoint.
const REVIEW_WORD = /(?:^|[/_.-])(?:review|note|discussion)s?(?:$|[/_.-])/;
// A review word past the subcommand is an argument, such as a file name.
const REVIEW_WORD_POSITIONS = 4;

// A command that posts a peer-review comment states the act in the words before
// its first flag. Only a path's last segment counts, so a directory name never does.
function isReviewCommand(command: ShellCommand): boolean {
  const words = [command.name, ...command.args.map((arg) => arg.text)];
  const firstFlag = words.findIndex((word) => word.startsWith("-"));
  return words
    .slice(0, Math.min(firstFlag === -1 ? words.length : firstFlag, REVIEW_WORD_POSITIONS))
    .some((word) => REVIEW_WORD.test(word.slice(word.lastIndexOf("/") + 1)));
}

function isGitMessageCommand(command: ShellCommand): boolean {
  const sub = command.args[0]?.text;
  return command.name === "git" && (sub === "commit" || sub === "tag");
}

/** Values of `--flag value` and `--flag=value` for any of `flags`. */
function flagValues(command: ShellCommand, flags: readonly string[]): ShellArg[] {
  const values: ShellArg[] = [];
  for (const [index, arg] of command.args.entries()) {
    const next = command.args[index + 1];
    const flag = flags.find((name) => arg.text.startsWith(`${name}=`));
    if (flags.includes(arg.text) && next !== undefined) values.push(next);
    else if (flag !== undefined) values.push({ ...arg, text: arg.text.slice(flag.length + 1) });
  }
  return values;
}

function literalPaths(values: ShellArg[]): string[] {
  return values
    .filter((value) => value.literal && value.text !== "" && value.text !== "-")
    .map((value) => value.text);
}

// `-F body=@path` reads the field's value from `path`.
function fieldFilePaths(command: ShellCommand): string[] {
  return literalPaths(flagValues(command, ["-F", "--field"])).flatMap((value) => {
    const at = value.indexOf("=@");
    const path = at === -1 ? "" : value.slice(at + 2);
    return path === "" || path === "-" ? [] : [path];
  });
}

// `"$(cat path)"` and `"$(< path)"` read the file into the value.
function substitutionPaths(value: ShellArg): string[] {
  return value.substitutions.flatMap((inner) =>
    inner.name === "cat" ? [...inner.stdin, ...literalPaths(inner.args)] : [],
  );
}

interface BashSources {
  files: string[];
  payloads: string[];
  inline: string[];
}

function bashSources(source: string): BashSources {
  const sources: BashSources = { files: [], payloads: [], inline: [] };
  for (const command of parseShell(source)) {
    const review = isReviewCommand(command);
    sources.files.push(...literalPaths(flagValues(command, BODY_FILE_FLAGS)));
    if (isGitMessageCommand(command)) {
      sources.files.push(...literalPaths(flagValues(command, ["-F", "--file"])));
    } else {
      sources.files.push(...fieldFilePaths(command));
    }
    if (review) {
      sources.payloads.push(...literalPaths(flagValues(command, ["--input"])));
      sources.files.push(...command.stdin);
    }
    const messages = flagValues(
      command,
      review ? [...PROSE_FLAGS, ...REVIEW_SHORT_FLAGS] : PROSE_FLAGS,
    );
    for (const value of messages) {
      if (value.literal) {
        if (value.text !== "") sources.inline.push(value.text);
      } else {
        sources.files.push(...substitutionPaths(value));
      }
    }
  }
  return sources;
}

async function readAll(paths: string[]): Promise<string[]> {
  const uid = process.getuid?.() ?? 0;
  const bodies = await Promise.all(
    paths.map((path) => readNewest(pathCandidates(path, process.env, uid))),
  );
  return bodies.filter((body) => body !== null);
}

export async function collectText(input: PreToolUseHookInput): Promise<string[]> {
  const toolInput = toolInputOf(input);
  const toolName = input.tool_name;

  if (toolName.startsWith("mcp__")) return strings(input.tool_input).filter(isProse);

  if (toolName === "Bash" && toolInput.command !== undefined) {
    const { files, payloads, inline } = bashSources(toolInput.command);
    const prose = (await readAll(payloads)).map(payloadProse).filter((text) => text !== null);
    return [...(await readAll(files)), ...prose, ...inline];
  }

  return [];
}

function messageKind(input: PreToolUseHookInput): "body" | "commit" | "review" {
  const commands = parseShell(toolInputOf(input).command ?? "");
  if (commands.some(isGitMessageCommand)) return "commit";
  if (
    commands.some(isReviewCommand) ||
    input.tool_name.split("__").some((part) => REVIEW_WORD.test(part))
  )
    return "review";
  return "body";
}

const SHELL_VAR_PATTERN = /\$\{?(\w+)\}?/g;

// The hook inherits TMPDIR from settings while a sandboxed shell gets /tmp/claude-<uid>,
// so a `$TMPDIR` path could name either directory.
export function pathCandidates(
  path: string,
  env: Record<string, string | undefined>,
  uid: number,
): string[] {
  if (!/\$\{?\w+\}?/.test(path)) return [path];
  const sandboxed: Record<string, string | undefined> = { ...env, TMPDIR: `/tmp/claude-${uid}` };
  const expand = (vars: Record<string, string | undefined>): string =>
    path.replaceAll(SHELL_VAR_PATTERN, (_match: string, name: string): string => vars[name] ?? "");
  return [...new Set([expand(env), expand(sandboxed)])];
}

async function readNewest(paths: string[]): Promise<string | null> {
  const found = await Promise.all(
    paths.map(async (path) => {
      const file = Bun.file(path);
      return (await file.exists()) ? { file, mtime: (await file.stat()).mtimeMs } : null;
    }),
  );
  const newest = found
    .filter((entry) => entry !== null)
    .toSorted((a, b) => b.mtime - a.mtime)
    .at(0);
  return newest == null ? null : newest.file.text();
}

// Each prose string becomes its own paragraph, so two comments never read as one.
function payloadProse(body: string): string | null {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return null;
  }
  const prose = strings(payload).filter(isProse);
  return prose.length === 0 ? null : prose.join("\n\n");
}

/** Alerts for the message prose a Bash or MCP call sends. An error-level alert denies the call. */
export async function lintMessages(input: PreToolUseHookInput): Promise<HookAlert[]> {
  const texts = await collectText(input);
  if (texts.length === 0) return [];
  const alerts = await valeAlerts(texts.join("\n"), { kind: messageKind(input) });
  return alerts.map((alert) => hookAlertOf(alert, decisionOf(alert.Severity, "PreToolUse")));
}
