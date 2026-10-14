import { URL } from "./rewrite";

export type Class = "glob" | "equals" | "reserved" | "split" | "bash-syntax";

export interface Note {
  class: Class;
  repeat: boolean;
  note: string;
}

interface Hit {
  class: Class;
  full: string;
  short: string;
}

const ERROR_LINE = /^(?:\(eval\)|zsh):\d+: (.*)$/gm;

function classify(message: string): Hit | undefined {
  const glob = /^no matches found: (.*)$/.exec(message);
  if (glob) {
    const pattern = glob[1] ?? "";
    const hint = "Quote the argument";
    return {
      class: "glob",
      full: URL.test(pattern)
        ? `zsh rejected \`${pattern}\` because it contains glob characters. ${hint}.`
        : `zsh skipped the command because \`${pattern}\` matched no files. That is not "no results", and \`2>/dev/null\` does not hide it. ${hint}, use \`fd\` or \`find\`, or prefix \`setopt nullglob;\`.`,
      short: "zsh glob with no match. Quote the pattern or use `fd`.",
    };
  }

  const equals = /^(\S+) not found$/.exec(message);
  if (equals) {
    return {
      class: "equals",
      full: `zsh expands a word starting with \`=\` as a command path, so \`=${equals[1]}\` failed. Quote words that start with \`=\`.`,
      short: "zsh `=` expansion. Quote words that start with `=`.",
    };
  }

  const reserved = /^read-only variable: (status|pipestatus)$/.exec(message);
  if (reserved) {
    return {
      class: "reserved",
      full: `\`${reserved[1]}\` is reserved in zsh. Rename the variable.`,
      short: "Reserved zsh variable. Rename it.",
    };
  }

  const split = /^command not found: (.*\s.*)$/.exec(message);
  if (split) {
    return {
      class: "split",
      full: `zsh does not word-split \`$var\`, so \`${split[1]}\` ran as one command name. Use an array, or \`\${=var}\`.`,
      short: `zsh does not word-split \`$var\`. Use an array or \`\${=var}\`.`,
    };
  }

  if (/^(bad substitution|bad math expression|invalid subscript)\b/.test(message)) {
    return {
      class: "bash-syntax",
      full: `This ran in zsh, not bash. A bash-only construct such as \`\${!var}\`, \`\${var:off:len}\` on arrays, or 0-based array indexing is the likely cause.`,
      short: "zsh, not bash. Check for a bash-only expansion.",
    };
  }

  return undefined;
}

export function explain(text: string, seen: Set<Class>): Note[] {
  const notes = new Map<Class, Note>();
  for (const match of text.matchAll(ERROR_LINE)) {
    const hit = classify(match[1] ?? "");
    if (!hit || notes.has(hit.class)) continue;
    const repeat = seen.has(hit.class);
    notes.set(hit.class, { class: hit.class, repeat, note: repeat ? hit.short : hit.full });
  }
  for (const c of notes.keys()) seen.add(c);
  return [...notes.values()];
}
