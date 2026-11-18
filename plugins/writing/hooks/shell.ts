import Parser, { type SyntaxNode } from "tree-sitter";
import Bash from "tree-sitter-bash";

export interface ShellArg {
  /** The word as the program receives it, with `$VAR` expansions left unexpanded. */
  text: string;
  /** False when a command substitution makes the value unknowable before it runs. */
  literal: boolean;
  substitutions: ShellCommand[];
}

export interface ShellCommand {
  name: string;
  args: ShellArg[];
  /** Paths read through `<`. */
  stdin: string[];
  /** Text fed to stdin through `<<`. */
  heredocs: string[];
}

const WRAPPERS = new Set(["command", "builtin", "exec", "nohup", "time", "env"]);

const parser = new Parser();
parser.setLanguage(Bash);

export function parseShell(source: string): ShellCommand[] {
  const commands: ShellCommand[] = [];
  collect(parser.parse(source).rootNode, commands);
  return commands;
}

function collect(node: SyntaxNode, out: ShellCommand[]): void {
  if (node.type === "command") {
    out.push(commandOf(node));
    return;
  }
  if (node.type === "redirected_statement") {
    const start = out.length;
    const body = node.childForFieldName("body");
    if (body !== null) collect(body, out);
    // A redirect after `a && b` belongs to `b`.
    const owner = out.at(-1);
    if (owner !== undefined && out.length > start) attachRedirects(node, owner);
    return;
  }
  for (const child of node.namedChildren) collect(child, out);
}

function attachRedirects(statement: SyntaxNode, owner: ShellCommand): void {
  for (const redirect of statement.childrenForFieldName("redirect")) {
    if (redirect.type === "heredoc_redirect") {
      const body = redirect.namedChildren.find((child) => child.type === "heredoc_body");
      owner.heredocs.push(body?.text ?? "");
      // tree-sitter-bash drops a bare `-` argument written just before `<<`.
      const before = redirect.previousSibling;
      const gap =
        before === null
          ? ""
          : statement.text.slice(
              before.endIndex - statement.startIndex,
              redirect.startIndex - statement.startIndex,
            );
      if (gap.trim() === "-") owner.args.push({ text: "-", literal: true, substitutions: [] });
      continue;
    }
    if (redirect.type !== "file_redirect") continue;
    const path = stdinPath(redirect);
    if (path !== null) owner.stdin.push(path);
  }
}

function stdinPath(redirect: SyntaxNode): string | null {
  const operator = redirect.children.find((child) => !child.isNamed)?.type;
  const destination = redirect.childForFieldName("destination");
  if (operator !== "<" || destination === null) return null;
  const arg = argOf(destination);
  return arg.literal ? arg.text : null;
}

function commandOf(node: SyntaxNode): ShellCommand {
  const words = [node.childForFieldName("name"), ...node.childrenForFieldName("argument")]
    .filter((word) => word !== null)
    .map(argOf);
  while (words.length > 1 && WRAPPERS.has(words[0]?.text ?? "")) words.shift();
  const [name, ...args] = words;
  return { name: name?.text ?? "", args, stdin: [], heredocs: [] };
}

function argOf(node: SyntaxNode): ShellArg {
  const arg: ShellArg = { text: "", literal: true, substitutions: [] };
  appendWord(node, arg);
  return arg;
}

function appendWord(node: SyntaxNode, arg: ShellArg): void {
  switch (node.type) {
    case "command_name":
    case "concatenation":
      for (const child of node.namedChildren) appendWord(child, arg);
      return;
    case "string":
      appendString(node, arg);
      return;
    case "word":
      arg.text += node.text.replaceAll(/\\(.)/gs, "$1");
      return;
    case "string_content":
      arg.text += node.text.replaceAll(/\\([$`"\\])/g, "$1");
      return;
    case "raw_string":
      arg.text += node.text.slice(1, -1);
      return;
    case "command_substitution":
      arg.literal = false;
      arg.text += node.text;
      arg.substitutions.push(...substitutionCommands(node));
      return;
    default:
      arg.text += node.text;
  }
}

// Text between a string's child nodes, such as a line break, belongs to the value.
function appendString(node: SyntaxNode, arg: ShellArg): void {
  const offset = (index: number): number => index - node.startIndex;
  for (const [index, child] of node.children.entries()) {
    const previous = node.children[index - 1];
    if (previous !== undefined) {
      arg.text += node.text.slice(offset(previous.endIndex), offset(child.startIndex));
    }
    if (child.isNamed) appendWord(child, arg);
  }
}

// `$(< path)` holds a bare redirect, which runs as `cat path`.
function substitutionCommands(node: SyntaxNode): ShellCommand[] {
  const inner: ShellCommand[] = [];
  for (const child of node.namedChildren) {
    if (child.type === "file_redirect") {
      const path = stdinPath(child);
      if (path !== null) inner.push({ name: "cat", args: [], stdin: [path], heredocs: [] });
    } else {
      collect(child, inner);
    }
  }
  return inner;
}
