import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { stripCode } from "../detection/code-spans";
import { valeAlerts } from "../detection/vale";
import { toolInputOf } from "./io";
import { hookAlertOf, type HookAlert } from "./report";

// The full set of Bash prose surfaces this hook scans. The hooks.json Bash
// guard is derived from these. hooks.test.ts enforces the sync.
export const PROSE_FLAGS = ["--body", "--message", "--description", "--title"] as const;
// gh reads a body from `--body-file`, glab from `--description-file`. Both name
// a path the hook can read, so both are scanned.
export const BODY_FILE_FLAGS = ["--body-file", "--description-file"] as const;

// gh api / glab api carry prose in `-F key=@file` / `--field key=@file` forms
// that the prose-flag alternation misses. The guard fragment ships to
// hooks.json verbatim, and hooks.test.ts enforces the sync.
export const FIELD_FILE_GUARD = "(-F|--field)[= ][^ ]*=@";

// git commit / git tag read their message from a file via -F / --file, with no
// `key=@` marker. Scoped to git so a bare `-F` in unrelated CLIs (curl) does
// not trigger file reads. Guard fragment shipped to hooks.json like the above.
export const GIT_MESSAGE_FILE_GUARD = "git (commit|tag).* (-F|--file)[= ]";

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

const BODY_FILE_PATTERN = new RegExp(`(?:${BODY_FILE_FLAGS.join("|")})[=\\s](\\S+)`);
const FIELD_FILE_PATTERN = /(?:^|\s)['"]?(?:-F|--field)[= ]([^\s=]+)=@(\S+)/g;
const GIT_MESSAGE_FILE_PATTERN = /\bgit\s+(?:commit|tag)\b[^|;&]*?\s(?:-F|--file)[= ](\S+)/g;

// Shell quoting survives into the raw command string, so a path captured from
// `-F 'body=@tmp/x.md'` carries the closing quote.
function stripQuotes(token: string): string {
  return token.replaceAll(/^['"]+|['"]+$/g, "");
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

function extractBodyFilePath(command: string): string | null {
  const match = command.match(BODY_FILE_PATTERN);
  const captured = match?.at(1);
  return captured != null && captured !== "" ? stripQuotes(captured) : null;
}

function extractFieldFilePaths(command: string): string[] {
  const paths: string[] = [];
  for (const match of command.matchAll(FIELD_FILE_PATTERN)) {
    const path = stripQuotes(match[2] ?? "");
    if (path !== "" && path !== "-") paths.push(path);
  }
  for (const match of command.matchAll(GIT_MESSAGE_FILE_PATTERN)) {
    const path = stripQuotes(match[1] ?? "");
    if (path !== "" && path !== "-") paths.push(path);
  }
  return paths;
}

const INLINE_ARG_PATTERNS = new Map<string, RegExp>(
  PROSE_FLAGS.map((flag) => [flag, new RegExp(`${flag}[= ](?:"([^"]+)"|'([^']+)')`)]),
);

function extractInlineArg(command: string, flag: string): string | null {
  const pattern = INLINE_ARG_PATTERNS.get(flag);
  if (!pattern) return null;
  const match = pattern.exec(command);
  return match?.[1] ?? match?.[2] ?? null;
}

export async function collectText(input: PreToolUseHookInput): Promise<string[]> {
  const toolInput = toolInputOf(input);
  const toolName = input.tool_name;

  if (toolName.startsWith("mcp__")) return strings(input.tool_input).filter(isProse);

  if (toolName === "Bash" && toolInput.command !== undefined) {
    const command = toolInput.command;
    const texts: string[] = [];
    const bodyFile = extractBodyFilePath(command);
    const files =
      bodyFile != null && bodyFile !== ""
        ? [bodyFile, ...extractFieldFilePaths(command)]
        : extractFieldFilePaths(command);
    const uid = process.getuid?.() ?? 0;
    const bodies = await Promise.all(
      files.map((path) => readNewest(pathCandidates(path, process.env, uid))),
    );
    texts.push(...bodies.filter((body) => body !== null));
    for (const flag of PROSE_FLAGS) {
      const value = extractInlineArg(command, flag);
      if (value != null && value !== "") texts.push(value);
    }
    return texts;
  }

  return [];
}

/** Alerts for the message prose a Bash or MCP call sends. An error-level alert denies the call. */
export async function lintMessages(input: PreToolUseHookInput): Promise<HookAlert[]> {
  const texts = await collectText(input);
  if (texts.length === 0) return [];
  const command = toolInputOf(input).command ?? "";
  const kind = /\bgit\s+(commit|tag)\b/.test(command) ? "commit" : "body";
  const alerts = await valeAlerts(texts.join("\n"), { kind });
  return alerts.map((alert) => hookAlertOf(alert, alert.Severity === "error" ? "deny" : "context"));
}
