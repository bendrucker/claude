import type { SessionMessage, UiSelection } from "claude-code";

const TITLE_LIMIT = 80;
// Things caps notes at 10,000 characters, split between the quote, the row, and the launch link.
const QUOTE_LIMIT = 4000;
const ROW_LIMIT = 2000;
// Measured encoded, since the launch link carries the quote URL-encoded.
const PROMPT_QUOTE_LIMIT = 1000;

export type Target = "things" | "linear";

export interface Row {
  label: string;
  text: string;
}

export interface Capture {
  title: string;
  quote: string;
  row: Row | undefined;
  launch: string;
}

function clip(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit - 1);
  // A lone high surrogate makes encodeURIComponent throw.
  return `${/[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut}…`;
}

function clipEncoded(text: string, limit: number): string {
  let kept = "";
  let used = 0;
  for (const char of text) {
    used += encodeURIComponent(char).length;
    if (used > limit) return `${kept}…`;
    kept += char;
  }
  return text;
}

function squash(text: string): string {
  return text.replaceAll(/\s+/g, " ").trim();
}

function encode(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");
}

export function quote(text: string): string {
  const quoted = text
    .trim()
    .split("\n")
    .map((line) => (line === "" ? ">" : `> ${line}`))
    .join("\n");
  return clip(quoted, QUOTE_LIMIT);
}

export function title(args: string, selected: string): string {
  const given = args.trim();
  if (given !== "") return clip(given, TITLE_LIMIT);
  const first = selected.trim().split("\n")[0] ?? "";
  return clip(first.trim(), TITLE_LIMIT);
}

function describeInput(input: Record<string, unknown>): string {
  for (const key of ["command", "file_path", "pattern", "url", "prompt"]) {
    const value = input[key];
    if (typeof value === "string") return value;
  }
  return JSON.stringify(input);
}

/**
 * The transcript row a selection lies in: the tool call its `requestId` names,
 * else the newest message whose text holds the selected text.
 */
export function row(selected: UiSelection, messages: readonly SessionMessage[]): Row | undefined {
  if (selected.requestId !== undefined) {
    for (const message of messages) {
      const use = message.toolUses.find((u) => u.tool_use_id === selected.requestId);
      if (use !== undefined)
        return { label: use.tool, text: clip(describeInput(use.input), ROW_LIMIT) };
    }
  }
  const needle = squash(selected.text);
  if (needle === "") return undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message === undefined || !squash(message.text).includes(needle)) continue;
    return {
      label: message.role === "user" ? "You" : "Claude",
      text: clip(message.text.trim(), ROW_LIMIT),
    };
  }
  return undefined;
}

/** The main checkout behind a worktree, from `git rev-parse --git-common-dir`. */
export function mainRepo(commonDir: string, root: string): string {
  const dir = commonDir.trim();
  return dir.endsWith("/.git") ? dir.slice(0, -"/.git".length) : root;
}

export function launchUrl(sessionId: string, quoted: string, cwd: string): string {
  const prompt = `Pick up this capture from Claude Code session ${sessionId} (\`claude --resume ${sessionId}\` has the full transcript):\n\n${clipEncoded(quoted, PROMPT_QUOTE_LIMIT)}`;
  return `claude-cli://open?${encode({ q: prompt, cwd })}`;
}

export function body(capture: Capture): string {
  const parts = [capture.quote];
  if (capture.row !== undefined) {
    parts.push(`From ${capture.row.label}:\n\n\`\`\`\n${capture.row.text}\n\`\`\``);
  }
  parts.push(`Continue in Claude Code: ${capture.launch}`);
  return parts.join("\n\n");
}

export function thingsUrl(capture: Capture): string {
  return `things:///add?${encode({ title: capture.title, notes: body(capture), tags: "claude" })}`;
}

export function linearUrl(capture: Capture): string {
  return `https://linear.new?${encode({ title: capture.title, description: body(capture) })}`;
}

export function targetUrl(target: Target, capture: Capture): string {
  return target === "things" ? thingsUrl(capture) : linearUrl(capture);
}
