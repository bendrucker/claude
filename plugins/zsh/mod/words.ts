/**
 * Where a word sits: `test` inside `[[ ]]`, `arith` for a `(( ))` command,
 * `assign` for `NAME=...`. zsh doesn't glob any of those.
 */
export type Context = "plain" | "test" | "arith" | "assign";

export interface Word {
  text: string;
  start: number;
  end: number;
  /** Per character of `text`, whether it is outside every quote, escape, and substitution. */
  unquoted: boolean[];
  context: Context;
  /** The simple command the word belongs to, numbered across the whole input. */
  command: number;
  /** The word's position within its command, 0 for the first. */
  index: number;
}

class UnbalancedError extends Error {
  override name = "UnbalancedError";
}

const BLANK = new Set([" ", "\t"]);
const BREAK = new Set([" ", "\t", "\n", ";", "&", "|", "(", ")", "<", ">"]);
// After one of these, the next word is in command position again.
const KEYWORDS = new Set([
  "if",
  "then",
  "else",
  "elif",
  "while",
  "until",
  "do",
  "{",
  "!",
  "time",
  "nocorrect",
  "noglob",
  "builtin",
  "command",
  "exec",
]);
const DECLARE = new Set(["typeset", "local", "export", "declare", "readonly", "integer", "float"]);
const ASSIGNMENT = /^[A-Za-z_]\w*(\[[^\]]*\])?\+?=/;
const REDIRECTS = ["<<<", "<<-", "<<", "<>", "<&", ">>|", ">>!", ">>", ">|", ">!", ">&", "<", ">"];

interface Heredoc {
  delimiter: string;
  strip: boolean;
}

/** Saved per substitution level, so words inside `$(...)` do not disturb the command around it. */
interface Level {
  command: number;
  index: number;
  test: boolean;
  named: boolean;
  declaring: boolean;
  header: boolean;
}

class Lexer {
  pos = 0;
  readonly found: Word[] = [];
  private commands = 0;
  private level: Level = {
    command: 0,
    index: 0,
    test: false,
    named: false,
    declaring: false,
    header: false,
  };
  private heredocs: Heredoc[] = [];

  constructor(private readonly src: string) {}

  private at(offset = 0): string | undefined {
    return this.src[this.pos + offset];
  }

  private newCommand(): void {
    this.level = {
      command: ++this.commands,
      index: 0,
      test: false,
      named: false,
      declaring: false,
      header: false,
    };
  }

  /** Lexes commands until `end` (unconsumed) or the end of input. */
  list(end: ")" | "`" | undefined): void {
    const outer = this.level;
    this.newCommand();
    let parens = 0;
    let cases = 0;
    for (;;) {
      const c = this.at();
      if (c === undefined) {
        if (end !== undefined) throw new UnbalancedError();
        if (this.heredocs.length > 0) throw new UnbalancedError();
        break;
      }
      if (c === end && (end !== ")" || parens === 0) && !(end === ")" && cases > 0)) break;
      if (BLANK.has(c)) {
        this.pos++;
      } else if (c === "\\" && this.at(1) === "\n") {
        this.pos += 2;
      } else if (c === "\n") {
        this.pos++;
        this.bodies();
        if (!this.level.test) this.newCommand();
      } else if (c === "#") {
        while (this.at() !== undefined && this.at() !== "\n") this.pos++;
      } else if (this.level.test && "&|()<>!".includes(c)) {
        this.pos++;
      } else if (c === "&" && this.at(1) === ">") {
        this.pos += this.at(2) === ">" ? 3 : 2;
      } else if (c === ";" || c === "&" || c === "|") {
        const two = c + (this.at(1) ?? "");
        this.pos += [";;", ";&", ";|", "&&", "||", "|&"].includes(two) ? 2 : 1;
        this.newCommand();
      } else if (c === "(" && this.at(1) === "(" && this.level.index === 0) {
        this.arith();
      } else if (c === "(") {
        this.pos++;
        parens++;
        this.newCommand();
      } else if (c === ")") {
        this.pos++;
        if (parens > 0) parens--;
        else if (cases === 0) throw new UnbalancedError();
        this.newCommand();
      } else if ((c === "<" || c === ">") && this.at(1) !== "(") {
        this.redirect();
      } else {
        const word = this.word(end);
        if (word === "case" && this.level.index === 1) cases++;
        if (word === "esac" && cases > 0) cases--;
      }
    }
    this.level = outer;
  }

  /** Skips each pending heredoc body, which starts at the current line. */
  private bodies(): void {
    for (const { delimiter, strip } of this.heredocs) {
      for (;;) {
        if (this.at() === undefined) throw new UnbalancedError();
        const eol = this.src.indexOf("\n", this.pos);
        const stop = eol === -1 ? this.src.length : eol;
        let line = this.src.slice(this.pos, stop);
        if (strip) line = line.replace(/^\t+/, "");
        this.pos = eol === -1 ? stop : stop + 1;
        if (line === delimiter) break;
      }
    }
    this.heredocs = [];
  }

  private redirect(): void {
    const op = REDIRECTS.find((r) => this.src.startsWith(r, this.pos)) ?? "";
    this.pos += op.length;
    if (op !== "<<" && op !== "<<-") return;
    while (BLANK.has(this.at() ?? "")) this.pos++;
    let delimiter = "";
    for (;;) {
      const c = this.at();
      if (c === undefined || BREAK.has(c)) break;
      if (c === "'" || c === '"') {
        const close = this.src.indexOf(c, this.pos + 1);
        if (close === -1) throw new UnbalancedError();
        delimiter += this.src.slice(this.pos + 1, close);
        this.pos = close + 1;
      } else if (c === "\\") {
        delimiter += this.at(1) ?? "";
        this.pos += 2;
      } else {
        delimiter += c;
        this.pos++;
      }
    }
    if (delimiter === "") throw new UnbalancedError();
    this.heredocs.push({ delimiter, strip: op === "<<-" });
  }

  /** A `(( ))` command, kept whole as one word. */
  private arith(): void {
    const start = this.pos;
    this.pos += 2;
    let depth = 0;
    for (;;) {
      const c = this.at();
      if (c === undefined) throw new UnbalancedError();
      this.pos++;
      if (c === "(") depth++;
      else if (c === ")" && depth > 0) depth--;
      else if (c === ")" && this.at() === ")") {
        this.pos++;
        break;
      }
    }
    this.emit(
      start,
      Array.from({ length: this.pos - start }, () => false),
      "arith",
    );
  }

  /** Reads one word, emits it, and returns its text. */
  private word(end: string | undefined): string {
    const start = this.pos;
    const bare = new Set<number>();
    for (;;) {
      const c = this.at();
      if (c === undefined || c === end) break;
      const next = this.at(1);
      if ((c === "<" || c === ">" || (c === "=" && this.pos === start)) && next === "(") {
        this.pos += 2;
        this.list(")");
        this.pos++;
      } else if (c === "(" && this.pos > start) {
        this.group(bare);
      } else if (BREAK.has(c)) {
        break;
      } else if (c === "'") {
        const close = this.src.indexOf("'", this.pos + 1);
        if (close === -1) throw new UnbalancedError();
        this.pos = close + 1;
      } else if (c === '"') {
        this.pos++;
        this.double();
        this.pos++;
      } else if (c === "\\") {
        this.pos += next === undefined ? 1 : 2;
      } else if (c === "`") {
        this.pos++;
        this.list("`");
        this.pos++;
      } else if (c === "$") {
        this.dollar();
      } else {
        bare.add(this.pos++);
      }
    }
    const text = this.src.slice(start, this.pos);
    // An fd number before a redirect, as in `2>/dev/null`.
    if (/^\d+$/.test(text) && (this.at() === "<" || this.at() === ">")) return text;
    const level = this.level;
    const flags = Array.from(text, (_, i) => bare.has(start + i));
    let context: Context = level.test ? "test" : "plain";
    if (
      !level.test &&
      (!level.named || level.declaring) &&
      ASSIGNMENT.test(text) &&
      flags.slice(0, text.indexOf("=")).every(Boolean)
    ) {
      context = "assign";
    }
    const literal = flags.every(Boolean);
    if (text === "[[" && literal && level.index === 0) {
      level.test = true;
      context = "test";
    }
    this.emit(start, flags, context);
    if (text === "]]" && literal && level.test) level.test = false;
    if (context === "plain" && !level.named) {
      level.named = true;
      if (KEYWORDS.has(text) && literal) this.newCommand();
      else if (DECLARE.has(text) && literal) level.declaring = true;
      else if (literal && (text === "function" || text.endsWith("()"))) level.header = true;
    } else if (text === "{" && literal && level.header) {
      this.newCommand();
    }
    return text;
  }

  /**
   * A parenthesized group inside a word: a glob group such as `*.(ts|js)`, a
   * qualifier such as `*(.)`, or an array after `NAME=`.
   */
  private group(bare: Set<number>): void {
    let depth = 0;
    for (;;) {
      const c = this.at();
      if (c === undefined || c === "\n") throw new UnbalancedError();
      bare.add(this.pos++);
      if (c === "(") depth++;
      else if (c === ")" && --depth === 0) return;
    }
  }

  /** The body of a double-quoted string, up to its closing quote. */
  private double(): void {
    for (;;) {
      const c = this.at();
      if (c === undefined) throw new UnbalancedError();
      if (c === '"') return;
      if (c === "\\") this.pos += 2;
      else if (c === "`") {
        this.pos++;
        this.list("`");
        this.pos++;
      } else if (c === "$") {
        this.dollar();
      } else this.pos++;
    }
  }

  private dollar(): void {
    const next = this.at(1);
    if (next === "'") {
      let i = this.pos + 2;
      for (; i < this.src.length && this.src[i] !== "'"; i++) if (this.src[i] === "\\") i++;
      if (i >= this.src.length) throw new UnbalancedError();
      this.pos = i + 1;
    } else if (next === "(" && this.at(2) === "(") {
      this.pos = this.balanced(this.pos + 1, "(", ")");
    } else if (next === "(") {
      this.pos += 2;
      this.list(")");
      this.pos++;
    } else if (next === "{") {
      this.pos = this.balanced(this.pos + 1, "{", "}");
    } else {
      this.pos++;
    }
  }

  /** The index just past the bracket that closes the one at `from`. */
  private balanced(from: number, open: string, close: string): number {
    let depth = 0;
    for (let i = from; i < this.src.length; i++) {
      const c = this.src[i];
      if (c === "\\") i++;
      else if (c === "'" && open === "{") {
        i = this.src.indexOf("'", i + 1);
        if (i === -1) break;
      } else if (c === open) depth++;
      else if (c === close && --depth === 0) return i + 1;
    }
    throw new UnbalancedError();
  }

  private emit(start: number, flags: boolean[], context: Context): void {
    this.found.push({
      text: this.src.slice(start, this.pos),
      start,
      end: this.pos,
      unquoted: flags,
      context,
      command: this.level.command,
      index: this.level.index++,
    });
  }
}

/**
 * Splits a shell command into words, including the words of every command
 * substitution, in source order. Comments and heredoc bodies yield no words.
 * Unbalanced input yields none at all, so a caller rewrites nothing.
 */
export function words(command: string): Word[] {
  const lexer = new Lexer(command);
  try {
    lexer.list(undefined);
  } catch (error) {
    if (error instanceof UnbalancedError) return [];
    throw error;
  }
  return lexer.found.toSorted((a, b) => a.start - b.start);
}
