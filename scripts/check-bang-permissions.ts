#!/usr/bin/env bun

import { join } from "node:path";
import { fromMarkdown } from "mdast-util-from-markdown";
import matter from "gray-matter";
import { visit } from "unist-util-visit";
import { assetPaths, COMMAND_GLOBS, frontmatter, root, SKILL_GLOBS } from "./assets";
import { runCheck } from "./check";

// A `!` injection that no rule approves falls to the auto-mode classifier,
// which can return no verdict and fail the skill load. These checks mirror how
// Claude Code 2.1.330 evaluates an injection: each subcommand is matched as raw
// text, quotes included, and a path outside the working directories needs a
// Read or Edit rule even when a Bash rule matches the command.

const OPERATORS = ["&&", "||", "|&", ";", "|", "&"];
const REDIRECT = /^\d*(?:>>?|<|>&|<&)(.*)$/;
const WRITERS = new Set(["mkdir", "touch", "cp", "mv", "rm", "tee", "ln"]);

/** The command text of every `!`-prefixed inline code span in a markdown body. */
export function bangCommands(markdown: string): string[] {
  const commands: string[] = [];
  visit(fromMarkdown(markdown), "inlineCode", (node, index, parent) => {
    const previous = index === undefined ? undefined : parent?.children[index - 1];
    if (previous?.type === "text" && previous.value.endsWith("!")) commands.push(node.value);
  });
  return commands;
}

/** Splits a shell line into simple commands, each a list of raw words with quotes kept. */
export function subcommands(command: string): string[][] {
  const result: string[][] = [];
  let words: string[] = [];
  let word = "";
  let quote: "'" | '"' | null = null;

  const endWord = () => {
    if (word !== "") words.push(word);
    word = "";
  };
  const endCommand = () => {
    endWord();
    if (words.length > 0) result.push(words);
    words = [];
  };

  for (let i = 0; i < command.length; i++) {
    const char = command[i] ?? "";
    if (quote !== null) {
      word += char;
      if (char === "\\" && quote === '"') word += command[++i] ?? "";
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      word += char;
    } else if (char === "\\") {
      word += char + (command[++i] ?? "");
    } else if (/\s/.test(char)) {
      endWord();
    } else {
      const operator = OPERATORS.find((op) => command.startsWith(op, i));
      // `>&` and `<&` are redirections, not a background `&`.
      if (operator !== undefined && !(operator === "&" && /[<>]$/.test(word))) {
        endCommand();
        i += operator.length - 1;
      } else {
        word += char;
      }
    }
  }
  endCommand();

  return result.map(withoutRedirections).filter((simple) => simple.length > 0);
}

function withoutRedirections(words: string[]): string[] {
  const kept: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i] ?? "";
    const match = REDIRECT.exec(word);
    if (!match) kept.push(word);
    else if (match[1] === "") i++;
  }
  return kept;
}

function unquote(word: string): string {
  return /^(['"]).*\1$/s.test(word) ? word.slice(1, -1) : word;
}

function globToRegExp(glob: string, separator: boolean): RegExp {
  const pattern = glob
    .split(/(\/\*\*|\*\*|\*)/)
    .map((part) => {
      // `dir/**` covers `dir` itself as well as everything under it.
      if (part === "/**") return "(?:/.*)?";
      if (part === "**") return ".*";
      if (part === "*") return separator ? "[^/]*" : ".*";
      return RegExp.escape(part);
    })
    .join("");
  return new RegExp(`^${pattern}$`, "s");
}

/** Whether a Bash permission rule pre-approves one simple command's text. */
export function allowsCommand(rule: string, command: string): boolean {
  if (rule === "Bash" || rule === "Bash(*)") return true;
  const match = /^Bash\((.*)\)$/s.exec(rule);
  if (!match) return false;
  const pattern = match[1] ?? "";
  if (pattern.endsWith(":*")) {
    const prefix = pattern.slice(0, -2);
    return command === prefix || command.startsWith(`${prefix} `);
  }
  return pattern.includes("*") ? globToRegExp(pattern, false).test(command) : pattern === command;
}

/** Whether a path-scoped Read or Edit rule covers a path. A bare `Read` does not. */
export function allowsPath(rule: string, tool: "Read" | "Edit", path: string): boolean {
  const match = new RegExp(`^${tool}\\((.*)\\)$`, "s").exec(rule);
  if (!match) return false;
  const scoped = match[1] ?? "";
  const pattern = scoped.startsWith("//") ? scoped.slice(1) : scoped;
  return globToRegExp(pattern, true).test(path);
}

function isOutsidePath(word: string): boolean {
  const path = unquote(word);
  return (path.startsWith("/") || path.startsWith("~/")) && path !== "/dev/null";
}

function rulesOf(value: unknown): string[] {
  if (typeof value === "string") return value.split(",").map((rule) => rule.trim());
  if (Array.isArray(value)) return value.filter((rule) => typeof rule === "string");
  return [];
}

/** Injected subcommands and paths in one markdown asset that its allowed-tools leaves unapproved. */
export function unapproved(file: string, text: string): string[] {
  const rules = rulesOf(frontmatter(text, file)["allowed-tools"]);
  const violations: string[] = [];
  for (const command of bangCommands(matter(text).content)) {
    for (const words of subcommands(command)) {
      const line = words.join(" ");
      if (!rules.some((rule) => allowsCommand(rule, line))) {
        violations.push(`${file}: no Bash rule matches \`${line}\``);
      }
      const tool = WRITERS.has(words[0] ?? "") ? "Edit" : "Read";
      for (const word of words.slice(1).filter(isOutsidePath)) {
        const path = unquote(word);
        if (!rules.some((rule) => allowsPath(rule, tool, path))) {
          violations.push(`${file}: no ${tool} rule covers \`${path}\` in \`${line}\``);
        }
      }
    }
  }
  return violations;
}

// Claude Code substitutes these as text before the shell runs, so a path with a
// space (Claude Desktop installs under `~/Library/Application Support`) splits
// into two words unless the injection quotes it.
const PATH_VARIABLE = /^\$\{?CLAUDE_(?:SKILL_DIR|PLUGIN_ROOT)\b\}?/;

/** Path variables in a shell line that are outside any quotes. */
export function unquotedPathVariables(command: string): string[] {
  const found: string[] = [];
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < command.length; i++) {
    const char = command[i] ?? "";
    if (quote !== null) {
      if (char === "\\" && quote === '"') i++;
      else if (char === quote) quote = null;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === "\\") {
      i++;
    } else {
      const match = PATH_VARIABLE.exec(command.slice(i));
      if (match) found.push(match[0]);
    }
  }
  return found;
}

/** Injections in one markdown asset that leave a plugin path variable unquoted. */
export function unquoted(file: string, text: string): string[] {
  return bangCommands(matter(text).content).flatMap((command) =>
    unquotedPathVariables(command).map(
      (variable) => `${file}: quote \`${variable}\` in \`${command}\``,
    ),
  );
}

if (import.meta.main) {
  await runCheck(
    async () => {
      const violations: string[] = [];
      for await (const file of assetPaths([...SKILL_GLOBS, ...COMMAND_GLOBS])) {
        const text = await Bun.file(join(root, file)).text();
        violations.push(...unquoted(file, text), ...unapproved(file, text));
      }
      return {
        header: [
          "`!` injections that can fail the skill load. Quote each plugin path variable, since",
          "the substituted path can contain a space. A Read or Edit rule in allowed-tools",
          "must name the path after symlink resolution, since Claude Code checks the real path:",
        ],
        violations,
      };
    },
    {
      success:
        "Every `!` injection quotes its plugin paths and is pre-approved by its allowed-tools",
    },
  );
}
