import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { extractComments } from "../detection/comments";
import { isProseFile } from "../detection/paths";
import {
  firstByTier,
  type PatternMatch,
  scan,
  scanIntroduced,
  semicolonSpliceHits,
} from "../detection/tropes";
import { formatContext, formatDecision, type HookResult } from "./io";

const FILE_OP_TOOLS = new Set(["Write", "Edit", "MultiEdit"]);

// The full set of Bash prose surfaces this hook scans. The hooks.json Bash
// guard is derived from these. hooks.test.ts enforces the sync.
export const PROSE_FLAGS = ["--body", "--message", "--description", "--title"] as const;
export const BODY_FILE_FLAG = "--body-file";

// gh api / glab api carry prose in `-F key=@file` / `--field key=@file` forms
// that the prose-flag alternation misses. The guard fragment ships to
// hooks.json verbatim, and hooks.test.ts enforces the sync.
export const FIELD_FILE_GUARD = "(-F|--field)[= ][^ ]*=@";

// git commit / git tag read their message from a file via -F / --file, with no
// `key=@` marker. Scoped to git so a bare `-F` in unrelated CLIs (curl) does
// not trigger file reads. Guard fragment shipped to hooks.json like the above.
export const GIT_MESSAGE_FILE_GUARD = "git (commit|tag).* (-F|--file)[= ]";

const BODY_FILE_PATTERN = new RegExp(`${BODY_FILE_FLAG}[=\\s](\\S+)`);
const FIELD_FILE_PATTERN = /(?:^|\s)['"]?(?:-F|--field)[= ]([^\s=]+)=@(\S+)/g;
const GIT_MESSAGE_FILE_PATTERN = /\bgit\s+(?:commit|tag)\b[^|;&]*?\s(?:-F|--file)[= ](\S+)/g;

// Shell quoting survives into the raw command string, so a path captured from
// `-F 'body=@tmp/x.md'` carries the closing quote.
function stripQuotes(token: string): string {
  return token.replace(/^['"]+|['"]+$/g, "");
}

function extractBodyFilePath(command: string): string | null {
  const match = command.match(BODY_FILE_PATTERN);
  return match?.[1] ? stripQuotes(match[1]) : null;
}

function extractFieldFilePaths(command: string): string[] {
  const paths: string[] = [];
  for (const match of command.matchAll(FIELD_FILE_PATTERN)) {
    const path = stripQuotes(match[2] ?? "");
    if (path && path !== "-") paths.push(path);
  }
  for (const match of command.matchAll(GIT_MESSAGE_FILE_PATTERN)) {
    const path = stripQuotes(match[1] ?? "");
    if (path && path !== "-") paths.push(path);
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

function collectMultiEditPairs(toolInput: Record<string, unknown>): {
  newText: string;
  oldText: string;
} {
  const edits = toolInput.edits;
  if (!Array.isArray(edits)) return { newText: "", oldText: "" };
  const newParts: string[] = [];
  const oldParts: string[] = [];
  for (const edit of edits) {
    if (!edit || typeof edit !== "object") continue;
    const fields = edit as Record<string, unknown>;
    if (typeof fields.new_string === "string") newParts.push(fields.new_string);
    if (typeof fields.old_string === "string") oldParts.push(fields.old_string);
  }
  return { newText: newParts.join("\n"), oldText: oldParts.join("\n") };
}

async function collectFileOpPair(
  input: PreToolUseHookInput,
): Promise<{ newText: string; oldText: string } | null> {
  const toolInput = input.tool_input as Record<string, unknown>;
  const toolName = input.tool_name;

  if (toolName === "Write") {
    const content = toolInput.content;
    if (typeof content !== "string" || content.length === 0) return null;
    const filePath = toolInput.file_path;
    let oldText = "";
    if (typeof filePath === "string") {
      const file = Bun.file(filePath);
      if (await file.exists()) oldText = await file.text();
    }
    return { newText: content, oldText };
  }

  if (toolName === "Edit") {
    const newString = toolInput.new_string;
    if (typeof newString !== "string" || newString.length === 0) return null;
    const oldString = toolInput.old_string;
    return { newText: newString, oldText: typeof oldString === "string" ? oldString : "" };
  }

  if (toolName === "MultiEdit") {
    const pair = collectMultiEditPairs(toolInput);
    if (pair.newText.length === 0) return null;
    return pair;
  }

  return null;
}

export async function collectText(input: PreToolUseHookInput): Promise<string[]> {
  const toolInput = input.tool_input as Record<string, unknown>;
  const toolName = input.tool_name;

  if (FILE_OP_TOOLS.has(toolName)) {
    const pair = await collectFileOpPair(input);
    return pair ? [pair.newText] : [];
  }

  if (toolName === "Bash" && typeof toolInput.command === "string") {
    const texts: string[] = [];
    const bodyFile = extractBodyFilePath(toolInput.command);
    const files = bodyFile
      ? [bodyFile, ...extractFieldFilePaths(toolInput.command)]
      : extractFieldFilePaths(toolInput.command);
    for (const path of files) {
      if (await Bun.file(path).exists()) {
        texts.push(await Bun.file(path).text());
      }
    }
    for (const flag of PROSE_FLAGS) {
      const value = extractInlineArg(toolInput.command, flag);
      if (value) texts.push(value);
    }
    return texts;
  }

  return [];
}

const WORDLIST_PATH_PATTERN = /\/wordlists\/[^/]+\.txt$/;

function isWordlistFile(input: PreToolUseHookInput): boolean {
  const filePath = (input.tool_input as Record<string, unknown>).file_path;
  if (typeof filePath !== "string") return false;
  return WORDLIST_PATH_PATTERN.test(filePath);
}

function buildFileOpReminder(
  toolName: string,
  filePath: string | undefined,
  deny: PatternMatch,
): string {
  const target = filePath ? `\`${filePath}\`` : "the file";
  if (toolName === "Write") {
    return `${deny.message} You wrote ${target} introducing this. Issue a follow-up Edit that fixes only the trope you just introduced. Do not modify unrelated parts of the file.`;
  }
  return `${deny.message} You introduced this in your edit to ${target}. Issue a follow-up Edit that targets only the text you just changed. Do not modify unrelated parts of the file, including other pre-existing tropes.`;
}

// Comments are short, so density gates cannot work there: a single introduced
// splice fires. Diff-aware like scanIntroduced, comparing splice counts across
// the old and new comment text.
const COMMENT_SPLICE_MIN = 1;

function commentSplice(comments: { newText: string; oldText: string }): string | null {
  const newHits = semicolonSpliceHits(comments.newText, COMMENT_SPLICE_MIN);
  if (newHits.count === 0) return null;
  const oldHits = semicolonSpliceHits(comments.oldText, COMMENT_SPLICE_MIN);
  if (newHits.count <= oldHits.count) return null;
  return `A code comment splices clauses with a semicolon ("${newHits.sample}"). Comments can be fragments. Use a period or drop a word.`;
}

async function processFileOp(input: PreToolUseHookInput): Promise<HookResult | null> {
  const pair = await collectFileOpPair(input);
  if (!pair) return null;
  const filePath = (input.tool_input as Record<string, unknown>).file_path as string | undefined;

  // Prose rules target prose. In a code file the model's prose surface is its
  // comments, so scan those; strings and identifiers are program text the
  // model did not write as prose.
  const prose = !filePath || isProseFile(filePath);
  const scanPair = prose
    ? pair
    : { newText: extractComments(pair.newText), oldText: extractComments(pair.oldText) };
  const matches = scanIntroduced(scanPair.newText, scanPair.oldText, filePath, "file");

  const deny = firstByTier(matches, "deny");
  if (deny) {
    // Deny-tier reminders instruct a per-file corrective edit, so repeat
    // suppression must never mute them even though they emit as context.
    return {
      output: formatContext(buildFileOpReminder(input.tool_name, filePath, deny)),
      category: deny.category,
      suppressible: false,
    };
  }

  const context = firstByTier(matches, "context");
  if (context) return { output: formatContext(context.message), category: context.category };

  if (!prose) {
    const splice = commentSplice(scanPair);
    if (splice) return { output: formatContext(splice), category: "comment splice" };
  }

  return null;
}

async function processSideEffect(input: PreToolUseHookInput): Promise<HookResult | null> {
  const texts = await collectText(input);
  if (texts.length === 0) return null;

  const matches = scan(texts.join("\n"), undefined, "sideEffect");

  // A structural deny blocks the call, so it outranks every other finding
  // regardless of where its pattern sits in the catalog. Selecting the first
  // deny of any kind would let a soft vocabulary hit that happens to be
  // declared earlier downgrade the block to a reminder.
  const structural = matches.find((match) => match.tier === "deny" && match.structural);
  if (structural) {
    return { output: formatDecision("deny", structural.message), category: structural.category };
  }

  const match = firstByTier(matches, "deny") ?? firstByTier(matches, "context");
  if (match) return { output: formatContext(match.message), category: match.category };

  return null;
}

export async function check(input: PreToolUseHookInput): Promise<HookResult | null> {
  if (isWordlistFile(input)) return null;

  if (FILE_OP_TOOLS.has(input.tool_name)) return processFileOp(input);
  return processSideEffect(input);
}
