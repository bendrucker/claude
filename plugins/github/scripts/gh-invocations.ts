// Imported by a hook that gates Bash calls, so this module uses no runtime dependency.

const SEPARATORS = new Set([";", "&", "|", "(", ")", "\n", "`"]);
const WHITESPACE = new Set([" ", "\t", "\r"]);
const PREFIX_WORDS = new Set([
  "do",
  "then",
  "else",
  "elif",
  "!",
  "{",
  "time",
  "exec",
  "nohup",
  "command",
]);
const ASSIGNMENT = /^[A-Za-z_]\w*=/;

/**
 * Splits a command into the simple commands it runs, as unquoted words.
 * Quote state carries across separators, so text quoted in an argument never
 * starts a command of its own.
 */
export function simpleCommands(command: string): string[][] {
  const commands: string[][] = [];
  let words: string[] = [];
  let word = "";
  let inWord = false;
  let quote: "'" | '"' | null = null;

  const endWord = () => {
    if (inWord) words.push(word);
    word = "";
    inWord = false;
  };
  const endCommand = () => {
    endWord();
    if (words.length > 0) commands.push(words);
    words = [];
  };

  for (let i = 0; i < command.length; i++) {
    const char = command[i] ?? "";
    if (quote !== null) {
      if (char === quote) quote = null;
      else if (quote === '"' && char === "\\" && i + 1 < command.length) word += command[++i];
      else word += char;
    } else if (char === "'" || char === '"') {
      quote = char;
      inWord = true;
    } else if (char === "\\" && i + 1 < command.length) {
      word += command[++i];
      inWord = true;
    } else if (SEPARATORS.has(char)) {
      endCommand();
    } else if (WHITESPACE.has(char)) {
      endWord();
    } else {
      word += char;
      inWord = true;
    }
  }
  endCommand();
  return commands;
}

function ghSubcommand(words: string[]): [string, string] | null {
  let i = 0;
  while (i < words.length && (PREFIX_WORDS.has(words[i] ?? "") || ASSIGNMENT.test(words[i] ?? "")))
    i++;
  if (words[i] !== "gh") return null;
  i++;
  // Global flags such as `-R owner/repo` stand between `gh` and its subcommand.
  while ((words[i] ?? "").startsWith("-")) i += (words[i] ?? "").includes("=") ? 1 : 2;
  return [words[i] ?? "", words[i + 1] ?? ""];
}

function invokes(command: string, group: string, action: string): boolean {
  return simpleCommands(command).some((words) => {
    const sub = ghSubcommand(words);
    return sub?.[0] === group && sub[1] === action;
  });
}

export const invokesWorkflowRun = (command: string): boolean => invokes(command, "workflow", "run");

export const invokesRunList = (command: string): boolean => invokes(command, "run", "list");
