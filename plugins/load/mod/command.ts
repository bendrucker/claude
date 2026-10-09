export interface Segment {
  words: string[];
  isBackground: boolean;
}

const SEPARATORS = new Set([";", "|", "\n", "(", ")", "`"]);

/** Splits a command line into simple commands. `2>&1` and `&>` stay inside one. */
export function segments(command: string): Segment[] {
  const out: Segment[] = [];
  let words: string[] = [];
  let word: string | undefined;

  const endWord = () => {
    if (word !== undefined) words.push(word);
    word = undefined;
  };
  const endSegment = (isBackground: boolean) => {
    endWord();
    if (words.length > 0) out.push({ words, isBackground });
    words = [];
  };

  for (let i = 0; i < command.length; i++) {
    const char = command.charAt(i);
    if (char === "'" || char === '"') {
      const end = command.indexOf(char, i + 1);
      const stop = end === -1 ? command.length : end;
      word = (word ?? "") + command.slice(i + 1, stop);
      i = stop;
    } else if (char === "\\") {
      word = (word ?? "") + command.charAt(i + 1);
      i++;
    } else if (char === "&" && (command[i - 1] === ">" || command[i + 1] === ">")) {
      word = (word ?? "") + char;
    } else if (char === "&" && command[i + 1] === "&") {
      endSegment(false);
      i++;
    } else if (char === "&") {
      endSegment(true);
    } else if (SEPARATORS.has(char)) {
      endSegment(false);
    } else if (/\s/.test(char)) {
      endWord();
    } else {
      word = (word ?? "") + char;
    }
  }
  endSegment(false);
  return out;
}

const DURATION = /^\d+(?:\.\d+)?[smhd]?$/;

const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s;

const PREFIXES = new Set([
  "do",
  "then",
  "else",
  "{",
  "!",
  "time",
  "nohup",
  "exec",
  "command",
  "env",
  "nice",
]);

export function splitPrefix(words: string[]): { env: Map<string, string>; argv: string[] } {
  const env = new Map<string, string>();
  let i = 0;
  for (; i < words.length; i++) {
    const word = words[i] ?? "";
    if (PREFIXES.has(word)) continue;
    if (word === "timeout") {
      while (i + 1 < words.length && !DURATION.test(words[i + 1] ?? "")) i++;
      i++;
      continue;
    }
    const match = ASSIGNMENT.exec(word);
    if (match === null) break;
    env.set(match[1] ?? "", match[2] ?? "");
  }
  return { env, argv: words.slice(i) };
}
