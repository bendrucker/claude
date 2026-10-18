/** One argument: `text` as the shell reads it, `raw` as written, quotes included. */
export interface Word {
  text: string;
  raw: string;
}

/** A pipeline, and the `&&` or `;` that joined it to the one before. */
interface Item {
  op: "&&" | ";" | null;
  elements: Word[][];
}

/** What stood between the chain and an `excludedCommands` match. */
export type Scaffold =
  | { kind: "cd"; raw: string }
  | { kind: "export"; raw: string; name: string; value: string }
  | { kind: "env"; raw: string; name: string; value: string }
  | { kind: "redirect"; raw: string }
  | { kind: "filter"; raw: string };

/** Why a bypass is let through: no form without the flag is known to escape. */
export type Pass = "unparsed" | "cd-elsewhere" | "env" | "unmatched" | "empty";

export type Verdict =
  | { deny: true; command: string; scaffolds: Scaffold[]; patterns: string[]; verbs: string[] }
  | { deny: false; reason: Pass; verbs: string[] };

/**
 * Output filters the harness makes redundant: it truncates long output, so a
 * trailing one only keeps the chain from matching.
 */
const FILTERS = new Set(["tail", "head", "grep", "wc", "sort", "uniq", "cut", "jq"]);

/** Variables a command takes as a flag, so the flag replaces the export. */
const FLAGS: Record<string, { command: string; flag: string }> = {
  AGENT_BROWSER_SESSION: { command: "agent-browser", flag: "--session" },
};

/** Options before a git subcommand that keep `git:*` from matching. */
const GIT_GLOBALS = /^(?:-c|-C|--git-dir|--work-tree)/;

const ASSIGNMENT = /^([A-Za-z_]\w*)=(.*)$/s;
const REDIRECT = "2>&1";

/**
 * Splits a command into pipelines of simple commands, or null for anything
 * past `&&`, `;`, newlines, pipes, quotes, and a `2>&1`. Expansion, grouping,
 * other redirections, and background jobs all return null, so the caller lets
 * the call through rather than guess at what the shell would run.
 */
export function parse(command: string): Item[] | null {
  const items: Item[] = [];
  let elements: Word[][] = [];
  let words: Word[] = [];
  let text = "";
  let start = -1;
  let op: Item["op"] = null;

  const endWord = (end: number) => {
    if (start === -1) return;
    words.push({ text, raw: command.slice(start, end) });
    text = "";
    start = -1;
  };
  const endElement = (end: number): boolean => {
    endWord(end);
    if (words.length === 0) return false;
    elements.push(words);
    words = [];
    return true;
  };
  const endItem = (end: number, next: Item["op"]): boolean => {
    if (!endElement(end) && elements.length > 0) return false;
    if (elements.length > 0) items.push({ op, elements });
    elements = [];
    op = next;
    return true;
  };

  for (let i = 0; i < command.length; i++) {
    const char = command.charAt(i);
    if (char === "'" || char === '"') {
      if (start === -1) start = i;
      const close = command.indexOf(char, i + 1);
      if (close === -1) return null;
      const body = command.slice(i + 1, close);
      if (char === '"' && /[$`\\]/.test(body)) return null;
      text += body;
      i = close;
    } else if (char === "\\") {
      if (start === -1) start = i;
      text += command.charAt(i + 1);
      i++;
    } else if (start === -1 && command.startsWith(REDIRECT, i)) {
      words.push({ text: REDIRECT, raw: REDIRECT });
      i += REDIRECT.length - 1;
    } else if (char === "&" && command[i + 1] === "&") {
      if (!endItem(i, "&&")) return null;
      i++;
    } else if (char === ";" || char === "\n") {
      if (!endItem(i, ";")) return null;
    } else if (char === "|") {
      if (command[i + 1] === "|" || command[i + 1] === "&" || !endElement(i)) return null;
    } else if ("&<>()`{}#".includes(char) || command.startsWith("$(", i)) {
      return null;
    } else if (/\s/.test(char)) {
      endWord(i);
    } else {
      if (start === -1) start = i;
      text += char;
    }
  }
  if (words.length === 0 && start === -1 && elements.length > 0) return null;
  endItem(command.length, null);
  return items;
}

/** Whether `text` matches one `excludedCommands` entry, in Bash permission-rule syntax. */
export function matches(pattern: string, text: string): boolean {
  const entry = pattern.trim();
  const prefix = entry.endsWith(":*") || entry.endsWith(" *") ? entry.slice(0, -2) : null;
  if (prefix !== null && !prefix.includes("*"))
    return text === prefix || text.startsWith(`${prefix} `);
  if (!entry.includes("*")) return text === entry;
  const source = entry
    .split("*")
    .map((part) => part.replaceAll(/[.+?^${}()|[\]\\]/g, String.raw`\$&`))
    .join(".*");
  return new RegExp(`^${source}$`, "s").test(text);
}

function escapes(words: Word[], patterns: string[]): string | undefined {
  if (words[0]?.text === "git" && GIT_GLOBALS.test(words[1]?.text ?? "")) return undefined;
  const text = words.map((word) => word.text).join(" ");
  return patterns.find((pattern) => matches(pattern, text));
}

function trimSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

interface Walk {
  scaffolds: Scaffold[];
  flags: Map<string, string>;
  patterns: Set<string>;
  verbs: string[];
  kept: { op: Item["op"]; elements: Word[][] }[];
}

/** A pipeline that only sets up the next: a `cd` or an `export`. Undefined when it is not one. */
function prelude(words: Word[], cwd: string | null, walk: Walk): Pass | null | undefined {
  const [head, ...rest] = words;
  if (head?.text === "cd" && rest.length === 1) {
    const target = rest[0]?.text ?? "";
    if (cwd === null || (target !== "." && trimSlash(target) !== trimSlash(cwd)))
      return "cd-elsewhere";
    walk.scaffolds.push({ kind: "cd", raw: words.map((word) => word.raw).join(" ") });
    return null;
  }
  const assigns = head?.text === "export" ? rest : words;
  if (assigns.length === 0 || !assigns.every((word) => ASSIGNMENT.test(word.text)))
    return undefined;
  for (const word of assigns) {
    const [, name = "", value = ""] = ASSIGNMENT.exec(word.text) ?? [];
    if (!(name in FLAGS)) return "env";
    walk.flags.set(name, value);
    walk.scaffolds.push({ kind: "export", raw: words.map((w) => w.raw).join(" "), name, value });
  }
  return null;
}

/** The command of one pipeline element, its inline assignments and `2>&1` lifted off. */
function lift(words: Word[], walk: Walk): Word[] | Pass {
  let index = 0;
  for (; index < words.length; index++) {
    const word = words[index];
    const match = ASSIGNMENT.exec(word?.text ?? "");
    if (word === undefined || match === null) break;
    const [, name = "", value = ""] = match;
    if (!(name in FLAGS)) return "env";
    walk.flags.set(name, value);
    walk.scaffolds.push({ kind: "env", raw: word.raw, name, value });
  }
  const command = words.slice(index).filter((word) => {
    if (word.text !== REDIRECT) return true;
    walk.scaffolds.push({ kind: "redirect", raw: REDIRECT });
    return false;
  });
  return command.length === 0 ? "empty" : command;
}

/** A pipeline's commands, trailing filters dropped, or why it does not escape. */
function pipeline(elements: Word[][], patterns: string[], walk: Walk): Word[][] | Pass {
  const commands: Word[][] = [];
  for (const [index, element] of elements.entries()) {
    const command = lift(element, walk);
    if (typeof command === "string") return command;
    const verb = command[0]?.text ?? "";
    const pattern = escapes(command, patterns);
    if (pattern !== undefined && commands.length === index) {
      commands.push(command);
      walk.patterns.add(pattern);
      walk.verbs.push(verb);
    } else if (index > 0 && FILTERS.has(verb)) {
      walk.scaffolds.push({
        kind: "filter",
        raw: `| ${command.map((word) => word.raw).join(" ")}`,
      });
    } else {
      walk.verbs.push(verb);
      return "unmatched";
    }
  }
  return commands;
}

/** Each command with a flag in place of an exported variable it reads. */
function withFlags(words: Word[], flags: Map<string, string>): string {
  const raw = words.map((word) => word.raw);
  for (const [name, value] of flags) {
    const { command, flag } = FLAGS[name] ?? { command: "", flag: "" };
    if (words[0]?.text !== command || words.some((word) => word.text === flag)) continue;
    const quoted = /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
    raw.splice(1, 0, flag, quoted);
  }
  return raw.join(" ");
}

/**
 * Judges a `dangerouslyDisableSandbox` call: denied when every command in it
 * matches `patterns` once the scaffolding is gone, since that form escapes the
 * sandbox with no flag. `cwd` is the directory the command starts in, the one
 * a `cd` to it is redundant in, or null where that is unknown and every `cd`
 * counts as going elsewhere.
 */
export function judge(command: string, patterns: string[], cwd: string | null): Verdict {
  const items = parse(command);
  if (items === null) return { deny: false, reason: "unparsed", verbs: [] };
  const walk: Walk = { scaffolds: [], flags: new Map(), patterns: new Set(), verbs: [], kept: [] };
  for (const { op, elements } of items) {
    const only = elements.length === 1 ? elements[0] : undefined;
    const set = only === undefined ? undefined : prelude(only, cwd, walk);
    if (typeof set === "string") return { deny: false, reason: set, verbs: walk.verbs };
    if (set === null) continue;
    const commands = pipeline(elements, patterns, walk);
    if (typeof commands === "string") return { deny: false, reason: commands, verbs: walk.verbs };
    walk.kept.push({ op, elements: commands });
  }
  if (walk.kept.length === 0) return { deny: false, reason: "empty", verbs: walk.verbs };
  const rewritten = walk.kept
    .map(({ op, elements }, index) => {
      const line = elements.map((words) => withFlags(words, walk.flags)).join(" | ");
      return index === 0 ? line : `${op === ";" ? ";" : " &&"} ${line}`;
    })
    .join("");
  return {
    deny: true,
    command: rewritten,
    scaffolds: walk.scaffolds,
    patterns: [...walk.patterns],
    verbs: walk.verbs,
  };
}

function note(scaffold: Scaffold): string {
  if (scaffold.kind === "export" || scaffold.kind === "env") {
    const { command, flag } = FLAGS[scaffold.name] ?? { command: "", flag: "" };
    return `\`${scaffold.raw}\`: pass \`${flag} ${scaffold.value}\` to \`${command}\` instead.`;
  }
  if (scaffold.kind === "cd")
    return `\`${scaffold.raw}\`: the command already runs in the session's directory.`;
  if (scaffold.kind === "redirect") return "`2>&1`: the harness already captures stderr.";
  return `\`${scaffold.raw}\`: the harness truncates long output itself.`;
}

/** The deny text: the form that escapes, and why each dropped piece is safe to drop. */
export function message(verdict: Extract<Verdict, { deny: true }>): string {
  const seen = new Set<string>();
  const notes = verdict.scaffolds.map(note).filter((text) => !seen.has(text) && seen.add(text));
  const entries = verdict.patterns.map((pattern) => `\`${pattern}\``).join(", ");
  const lines = [
    `This call needs no \`dangerouslyDisableSandbox\`: every command in it matches \`sandbox.excludedCommands\` (${entries}), so it runs outside the sandbox on its own.`,
    notes.length === 0
      ? "It escapes as written. Rerun it without the flag."
      : "Rerun it without the flag, and without the pieces that keep the chain from matching:",
  ];
  if (notes.length > 0)
    lines.push("", `    ${verdict.command}`, "", ...notes.map((text) => `- ${text}`));
  return lines.join("\n");
}
