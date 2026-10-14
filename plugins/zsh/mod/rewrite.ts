import { type Word, words } from "./words";

export type Rule = "flag-glob" | "equals" | "url";

/** `glob` gates `flag-glob` and `url`. */
export interface Gates {
  glob: boolean;
  equals: boolean;
}

interface Edit {
  start: number;
  end: number;
  text: string;
  rule: Rule;
}

const FLAG = /^--[A-Za-z0-9][\w-]*=/;
export const URL = /^[A-Za-z][\w+.-]*:\/\//;
const FIND = /^(?:.*\/)?find$/;
const PREDICATES = new Set([
  "-name",
  "-iname",
  "-path",
  "-ipath",
  "-wholename",
  "-iwholename",
  "-lname",
  "-ilname",
]);
// Prefixes that run the next word as the command. Their own flags are skipped too.
const ASSIGNMENT = /^[A-Za-z_]\w*=/;
const WRAPPERS = new Set(["sudo", "env", "nice", "nohup"]);
const GLOB = /[*?[]/;
const BRACE = /([{},])/;

/**
 * Single-quotes `span`. When it holds a brace expansion, only the runs between
 * `{`, `,` and `}` that contain a glob character are quoted, so the braces still expand.
 */
function quote(span: string): string | undefined {
  if (!span.includes("{")) return `'${span}'`;
  const parts = span.split(BRACE).map((part) => {
    if (part === "{" || part === "}" || part === "," || !GLOB.test(part)) return part;
    return part.startsWith("~") || part.startsWith("=") ? undefined : `'${part}'`;
  });
  return parts.includes(undefined) ? undefined : parts.join("");
}

function edit(w: Word, from: number, rule: Rule): Edit | undefined {
  const span = w.text.slice(from);
  if (span.startsWith("~") || !w.unquoted.slice(from).every(Boolean)) return undefined;
  const text = quote(span);
  if (text === undefined) return undefined;
  return { start: w.start + from, end: w.end, text, rule };
}

function findValues(all: Word[]): Set<Word> {
  const values = new Set<Word>();
  const byCommand = new Map<number, Word[]>();
  for (const w of all) {
    const list = byCommand.get(w.command);
    if (list === undefined) byCommand.set(w.command, [w]);
    else list.push(w);
  }
  for (const list of byCommand.values()) {
    const head = list.find(
      (w) => !ASSIGNMENT.test(w.text) && !WRAPPERS.has(w.text) && !w.text.startsWith("-"),
    );
    if (head === undefined || !FIND.test(head.text) || !head.unquoted.every(Boolean)) continue;
    for (const w of list) {
      if (w.context !== "plain" || !PREDICATES.has(w.text)) continue;
      const value = list.find((v) => v.index === w.index + 1);
      if (value !== undefined) values.add(value);
    }
  }
  return values;
}

function hasGlob(w: Word, from: number, chars: string): boolean {
  for (let i = from; i < w.text.length; i++) {
    if (w.unquoted[i] && chars.includes(w.text[i] ?? "")) return true;
  }
  return false;
}

function ruleFor(w: Word, findValue: boolean, gates: Gates): Edit | undefined {
  if (gates.glob) {
    if (findValue && hasGlob(w, 0, "*?[")) return edit(w, 0, "flag-glob");
    const flag = FLAG.exec(w.text);
    if (flag !== null && w.text.length > flag[0].length && hasGlob(w, flag[0].length, "*?[")) {
      return edit(w, flag[0].length, "flag-glob");
    }
    if (URL.test(w.text) && hasGlob(w, 0, "?*[")) return edit(w, 0, "url");
  }
  if (gates.equals && w.text.length > 1 && w.text.startsWith("=")) {
    if (w.text.includes("{")) return undefined;
    return edit(w, 0, "equals");
  }
  return undefined;
}

/**
 * Single-quotes the words zsh would glob or `=`-expand where bash would pass
 * them through. Returns the command unchanged when no rule fires.
 */
export function rewrite(command: string, gates: Gates): { command: string; rules: Rule[] } {
  if (!gates.glob && !gates.equals) return { command, rules: [] };
  if (!/[*?[=]/.test(command)) return { command, rules: [] };
  const all = words(command);
  const values = findValues(all);
  const edits: Edit[] = [];
  for (const w of all) {
    if (w.context !== "plain" || w.text.includes("'") || w.text.includes("$")) continue;
    const e = ruleFor(w, values.has(w), gates);
    if (e !== undefined) edits.push(e);
  }
  const rules = [...new Set(edits.map((e) => e.rule))];
  let out = command;
  for (const e of edits.toSorted((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  return { command: out, rules };
}
