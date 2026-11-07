// A hook matches a tool only where it is invoked, so quoted text, heredoc
// bodies, and comments never produce a command. No runtime dependencies:
// gating hooks import this module.

export interface Word {
  /** The argument as the program receives it, quotes removed. */
  text: string;
  quote: "bare" | "single" | "double" | "mixed";
}

export interface Heredoc {
  body: string;
  /** A quoted delimiter (`<<'EOF'`) means the shell expands nothing in the body. */
  quoted: boolean;
}

export interface Command {
  program: string;
  args: Word[];
  assignments: string[];
  /** Words such as `while`, `do`, or `!` that introduced the command. */
  keywords: string[];
  heredocs: Heredoc[];
  /** The command whose `$(...)` or backtick substitution holds this one. */
  parent: Command | null;
}

const KEYWORDS = new Set(["if", "then", "else", "elif", "do", "while", "until", "!", "{"]);
// Words that stand ahead of the command they run.
const WRAPPERS = new Set(["command", "builtin", "exec", "time", "nohup", "env"]);
const ASSIGNMENT = /^[A-Za-z_]\w*=/;
const DOUBLE_QUOTED_ESCAPES = new Set(["$", "`", '"', "\\"]);
const REDIRECT_CHARS = new Set([">", "<"]);

interface PendingHeredoc {
  delimiter: string;
  strip: boolean;
  quoted: boolean;
  owner: DraftCommand;
}

interface DraftCommand {
  words: Word[];
  heredocs: Heredoc[];
  parent: Command | null;
  finished: Command | null;
}

class Scanner {
  readonly commands: Command[] = [];
  private index = 0;

  constructor(private readonly source: string) {}

  scan(): Command[] {
    this.scanCommands(null, null);
    return this.commands;
  }

  /** Scans until `terminator` closes a substitution, or to the end of the source. */
  private scanCommands(terminator: ")" | "`" | null, parent: Command | null): void {
    const src = this.source;
    let draft: DraftCommand | null = null;
    let text = "";
    let kinds = new Set<Word["quote"]>();
    let inWord = false;
    const pending: PendingHeredoc[] = [];

    const ensureDraft = (): DraftCommand => {
      draft ??= { words: [], heredocs: [], parent, finished: null };
      return draft;
    };
    const endWord = () => {
      if (!inWord) return;
      let quote: Word["quote"] = "bare";
      if (kinds.has("single") && kinds.has("double")) quote = "mixed";
      else if (kinds.has("single")) quote = "single";
      else if (kinds.has("double")) quote = "double";
      const word: Word = { text, quote };
      const current = ensureDraft();
      current.words.push(word);
      if (current.finished) current.finished.args.push(word);
      else this.register(current);
      text = "";
      kinds = new Set();
      inWord = false;
    };
    const endCommand = () => {
      endWord();
      draft = null;
    };
    const append = (chunk: string, kind: Word["quote"]) => {
      text += chunk;
      kinds.add(kind);
      inWord = true;
    };
    // A substitution's commands belong to the command being built, which must
    // already hold the words before it.
    const owner = (): Command | null => {
      const current = ensureDraft();
      this.register(current);
      return current.finished ?? parent;
    };
    const substitution = (kind: Word["quote"]): void => {
      const start = this.index;
      const closer = src[start + 1] === "(" ? ")" : "`";
      this.index += closer === ")" ? 2 : 1;
      this.scanCommands(closer, owner());
      append(src.slice(start, this.index), kind);
    };

    while (this.index < src.length) {
      const char = src.charAt(this.index);
      const next = src[this.index + 1];

      if (terminator === ")" && char === ")") {
        endCommand();
        this.index += 1;
        return;
      }
      if (terminator === "`" && char === "`") {
        endCommand();
        this.index += 1;
        return;
      }

      if (char === "\\") {
        if (next === "\n") {
          this.index += 2;
          continue;
        }
        if (next !== undefined) append(next, "bare");
        this.index += 2;
        continue;
      }
      if (char === "'") {
        const close = src.indexOf("'", this.index + 1);
        const end = close === -1 ? src.length : close;
        append(src.slice(this.index + 1, end), "single");
        this.index = end + 1;
        continue;
      }
      if (char === '"') {
        this.index += 1;
        let chunk = "";
        inWord = true;
        kinds.add("double");
        const flush = () => {
          text += chunk;
          chunk = "";
        };
        while (this.index < src.length && src[this.index] !== '"') {
          const inner = src.charAt(this.index);
          const innerNext = src[this.index + 1];
          if (inner === "\\" && innerNext !== undefined && DOUBLE_QUOTED_ESCAPES.has(innerNext)) {
            chunk += innerNext;
            this.index += 2;
          } else if (inner === "$" && innerNext === "(") {
            flush();
            substitution("double");
          } else if (inner === "`") {
            flush();
            substitution("double");
          } else {
            chunk += inner;
            this.index += 1;
          }
        }
        flush();
        this.index += 1;
        continue;
      }
      if (char === "$" && next === "(") {
        substitution("bare");
        continue;
      }
      if (char === "`") {
        substitution("bare");
        continue;
      }
      if (char === "<" && next === "<" && src[this.index + 2] !== "<") {
        this.readHeredocMarker(ensureDraft(), pending);
        continue;
      }
      if (REDIRECT_CHARS.has(char)) {
        append(char, "bare");
        this.index += 1;
        if (src[this.index] === "&") {
          append("&", "bare");
          this.index += 1;
        }
        continue;
      }
      if (char === "#" && !inWord) {
        const eol = src.indexOf("\n", this.index);
        this.index = eol === -1 ? src.length : eol;
        continue;
      }
      if (char === "\n") {
        endCommand();
        this.index += 1;
        this.readHeredocBodies(pending);
        continue;
      }
      if (char === " " || char === "\t" || char === "\r") {
        endWord();
        this.index += 1;
        continue;
      }
      if (char === "&" && next === ">") {
        append("&>", "bare");
        this.index += 2;
        continue;
      }
      if (char === ";" || char === "&" || char === "|" || char === "(" || char === ")") {
        endCommand();
        this.index += 1;
        continue;
      }
      append(char, "bare");
      this.index += 1;
    }
    endCommand();
  }

  private readHeredocMarker(draft: DraftCommand, pending: PendingHeredoc[]): void {
    const src = this.source;
    this.index += 2;
    const strip = src[this.index] === "-";
    if (strip) this.index += 1;
    while (src[this.index] === " " || src[this.index] === "\t") this.index += 1;

    let delimiter = "";
    let quoted = false;
    while (this.index < src.length && !/[\s;&|()<>]/.test(src.charAt(this.index))) {
      const char = src.charAt(this.index);
      if (char === "'" || char === '"') {
        quoted = true;
        const close = src.indexOf(char, this.index + 1);
        const end = close === -1 ? src.length : close;
        delimiter += src.slice(this.index + 1, end);
        this.index = end + 1;
      } else if (char === "\\") {
        quoted = true;
        delimiter += src[this.index + 1] ?? "";
        this.index += 2;
      } else {
        delimiter += char;
        this.index += 1;
      }
    }
    pending.push({ delimiter, strip, quoted, owner: draft });
  }

  private readHeredocBodies(pending: PendingHeredoc[]): void {
    const src = this.source;
    for (const heredoc of pending.splice(0)) {
      const lines: string[] = [];
      while (this.index < src.length) {
        const eol = src.indexOf("\n", this.index);
        const end = eol === -1 ? src.length : eol;
        let line = src.slice(this.index, end);
        this.index = eol === -1 ? src.length : eol + 1;
        if (heredoc.strip) line = line.replace(/^\t+/, "");
        if (line === heredoc.delimiter) break;
        lines.push(line);
      }
      heredoc.owner.heredocs.push({ body: lines.join("\n"), quoted: heredoc.quoted });
    }
  }

  private register(draft: DraftCommand | null): void {
    if (draft == null || draft.finished != null) return;
    const assignments: string[] = [];
    const keywords: string[] = [];
    let position = 0;
    const words = draft.words;
    for (const word of words) {
      if (word.quote === "bare" && KEYWORDS.has(word.text)) keywords.push(word.text);
      else if (word.quote === "bare" && WRAPPERS.has(word.text)) {
        // wrappers add nothing to the command they precede
      } else if (ASSIGNMENT.test(word.text)) assignments.push(word.text);
      else break;
      position += 1;
    }
    const programWord = words[position];
    if (programWord == null) return;

    const command: Command = {
      program: programWord.text,
      args: words.slice(position + 1),
      assignments,
      keywords,
      heredocs: draft.heredocs,
      parent: draft.parent,
    };
    draft.finished = command;
    this.commands.push(command);
  }
}

export function parseCommands(source: string): Command[] {
  return new Scanner(source).scan();
}

export function isProgram(command: Command, name: string): boolean {
  return command.program === name || command.program.endsWith(`/${name}`);
}

export function commandsOf(commands: Command[], name: string): Command[] {
  return commands.filter((command) => isProgram(command, name));
}

/** Arguments that are not flags, skipping the value after the repository flag. */
export function positionals(command: Command): string[] {
  const result: string[] = [];
  let skipNext = false;
  for (const { text } of command.args) {
    if (skipNext) {
      skipNext = false;
    } else if (text === "-R" || text === "--repo") {
      skipNext = true;
    } else if (!text.startsWith("-")) {
      result.push(text);
    }
  }
  return result;
}

export function hasFlag(command: Command, ...flags: string[]): boolean {
  return command.args.some(({ text }) =>
    flags.some((flag) => text === flag || text.startsWith(`${flag}=`)),
  );
}

export function isDescendant(command: Command, ancestor: Command): boolean {
  for (let parent = command.parent; parent != null; parent = parent.parent) {
    if (parent === ancestor) return true;
  }
  return false;
}
