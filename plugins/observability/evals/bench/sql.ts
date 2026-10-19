/**
 * Recovers the SQL a Bash `duckdb` call sent to the session index, so the queries agents
 * actually ran can be replayed and counted. An unrecognized command returns an empty list.
 */

/** A named query carries its `SET VARIABLE` prelude in `sql`; ad-hoc SQL carries the whole text. */
export interface Statement {
  name?: string;
  sql: string;
}

type Token = { op: string } | { word: string };

const OPS = ["<<<", "<<-", "&&", "||", "<<", "|", ";", "<", ">", "(", ")", "\n", "&"];
const SEPARATORS = new Set([";", "&&", "||", "\n", "&"]);
// Flags of the duckdb CLI that take a value. Every other flag is a switch.
const VALUE_FLAGS = new Set(["-init", "-cmd", "-c", "-s", "-separator", "-newline", "-nullvalue"]);
const NAMED = /(?:^|\/)queries\/([\w-]+)\.sql$/;

function isWord(t: Token | undefined): t is { word: string } {
  return t !== undefined && "word" in t;
}

function isOp(t: Token | undefined, ...ops: string[]): t is { op: string } {
  return t !== undefined && "op" in t && ops.includes(t.op);
}

function readQuoted(text: string, start: number, quote: string): [string, number] {
  let out = "";
  let i = start;
  while (i < text.length && text[i] !== quote) {
    if (quote === '"' && text[i] === "\\" && '"\\$`\n'.includes(text[i + 1] ?? "")) i++;
    out += text[i];
    i++;
  }
  return [out, i + 1];
}

function readPart(text: string, i: number): [string, number] {
  const c = text[i] ?? "";
  if (c === "'" || c === '"') return readQuoted(text, i + 1, c);
  if (c === "$" && text[i + 1] === "'") {
    const [inner, next] = readQuoted(text, i + 2, "'");
    return [inner.replaceAll(String.raw`\n`, "\n").replaceAll(String.raw`\t`, "\t"), next];
  }
  if (c === "\\") return [text[i + 1] === "\n" ? "" : (text[i + 1] ?? ""), i + 2];
  return [c, i + 1];
}

function readDelimiter(text: string, start: number): [string, number] {
  let i = start;
  while (text[i] === " ") i++;
  let delim = "";
  while (i < text.length && !" \t\n;|&<>".includes(text[i] ?? "")) {
    const [part, next] = readPart(text, i);
    delim += part;
    i = next;
  }
  return [delim, i];
}

function readBody(text: string, start: number, delim: string, strip: boolean): [string, number] {
  const lines: string[] = [];
  let i = start;
  while (i < text.length) {
    const end = text.indexOf("\n", i);
    const line = text.slice(i, end === -1 ? text.length : end);
    i = end === -1 ? text.length : end + 1;
    if ((strip ? line.trim() : line) === delim) break;
    lines.push(line);
  }
  return [lines.join("\n"), i];
}

/** Shell tokens, with each heredoc body as the word after its `<<` operator. */
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const pending: { delim: string; strip: boolean; index: number }[] = [];
  let word: string | undefined;
  const flush = () => {
    if (word !== undefined) tokens.push({ word });
    word = undefined;
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i] ?? "";
    const op = OPS.find((o) => text.startsWith(o, i));
    if (word === undefined && c === "#") {
      const end = text.indexOf("\n", i);
      i = end === -1 ? text.length : end;
    } else if (c === " " || c === "\t") {
      flush();
      i++;
    } else if (op === undefined) {
      const [part, next] = readPart(text, i);
      word = (word ?? "") + part;
      i = next;
    } else {
      flush();
      tokens.push({ op });
      i += op.length;
      if (op === "<<" || op === "<<-") {
        const [delim, next] = readDelimiter(text, i);
        pending.push({ delim, strip: op === "<<-", index: tokens.length });
        tokens.push({ word: "" });
        i = next;
      }
      for (const doc of op === "\n" ? pending.splice(0) : []) {
        const [body, next] = readBody(text, i, doc.delim, doc.strip);
        tokens[doc.index] = { word: body };
        i = next;
      }
    }
  }
  flush();
  return tokens;
}

/** The program a simple command runs, past env assignments and wrappers, and its arguments. */
function program(argv: string[]): [string, string[]] {
  let rest = argv.filter((w) => w !== "{" && w !== "}");
  while (rest[0] !== undefined && /^[A-Za-z_]\w*=/.test(rest[0])) rest = rest.slice(1);
  if (rest[0] === "timeout") rest = rest.slice(2);
  if (rest[0] === "command" || rest[0] === "exec") rest = rest.slice(1);
  const [head = "", ...args] = rest;
  return [head.split("/").at(-1) ?? "", args];
}

function split(tokens: Token[], at: (t: Token) => boolean): Token[][] {
  const parts: Token[][] = [[]];
  let depth = 0;
  for (const t of tokens) {
    if (isOp(t, "(") || (isWord(t) && t.word === "{")) depth++;
    if (isOp(t, ")") || (isWord(t) && t.word === "}")) depth--;
    if (depth === 0 && at(t)) parts.push([]);
    else parts.at(-1)?.push(t);
  }
  return parts;
}

function words(tokens: Token[]): string[] {
  return tokens.filter(isWord).map((t) => t.word);
}

/** Text an upstream `echo`, `printf`, or `cat` feeds into the pipe, and a query file it cats. */
function upstream(tokens: Token[]): { text: string[]; name?: string } {
  const text: string[] = [];
  let name: string | undefined;
  const flat = tokens.filter((t) => !isOp(t, "(", ")") && !(isWord(t) && /^[{}]$/.test(t.word)));
  for (const command of split(flat, (t) => !isWord(t))) {
    const [prog, args] = program(words(command));
    if (prog === "echo") text.push(args.filter((a) => !/^-[neE]+$/.test(a)).join(" "));
    if (prog === "printf") text.push((args[0] ?? "").replaceAll(String.raw`\n`, "\n"));
    if (prog === "cat") name = args.map((a) => NAMED.exec(a)?.[1]).find(Boolean) ?? name;
  }
  return name === undefined ? { text } : { text, name };
}

function own(
  args: string[],
  redirects: Token[],
): { prelude: string[]; body: string[]; name?: string } {
  const prelude: string[] = [];
  const body: string[] = [];
  const positional: string[] = [];
  for (let a = 0; a < args.length; a++) {
    const arg = args[a] ?? "";
    if (VALUE_FLAGS.has(arg)) {
      const value = args[++a] ?? "";
      if (arg === "-cmd") prelude.push(value);
      if (arg === "-c" || arg === "-s") body.push(value);
    } else if (!arg.startsWith("-")) positional.push(arg);
  }
  body.push(...positional.slice(1));
  let name: string | undefined;
  for (const [r, op] of redirects.entries()) {
    const target = redirects[r + 1];
    if (!isWord(target)) continue;
    if (isOp(op, "<")) name = NAMED.exec(target.word)?.[1] ?? name;
    if (isOp(op, "<<", "<<-", "<<<")) body.push(target.word);
  }
  return name === undefined ? { prelude, body } : { prelude, body, name };
}

/** The statements each `duckdb` call in a Bash command sent. */
export function statements(command: string): Statement[] {
  const found: Statement[] = [];
  for (const pipeline of split(tokenize(command), (t) => isOp(t, ...SEPARATORS))) {
    const stages = split(pipeline, (t) => isOp(t, "|"));
    for (const [n, stage] of stages.entries()) {
      const lead = stage.findIndex((t) => !isWord(t) && !isOp(t, "(", ")"));
      const head = lead === -1 ? stage : stage.slice(0, lead);
      const [prog, args] = program(words(head));
      if (prog !== "duckdb") continue;
      const call = own(args, lead === -1 ? [] : stage.slice(lead));
      const fed = upstream(stages.slice(0, n).flat());
      const name = call.name ?? fed.name;
      const sql = [...fed.text, ...call.prelude, ...call.body]
        .map((s) => s.trim())
        .filter(Boolean)
        .join("\n");
      if (name !== undefined) found.push({ name, sql });
      else if (sql !== "") found.push({ sql });
    }
  }
  return found;
}

/** A grouping key that ignores literals, comments, case, and spacing. */
export function normalize(sql: string): string {
  return sql
    .replaceAll(/--[^\n]*/g, " ")
    .replaceAll(/\/\*[\s\S]*?\*\//g, " ")
    .replaceAll(/'(?:[^']|'')*'/g, "?")
    .replaceAll(/\b\d+(?:\.\d+)?\b/g, "?")
    .replaceAll(/\s+/g, " ")
    .replace(/\s*;\s*$/, "")
    .trim()
    .toLowerCase();
}
