// A shell command as the list of simple commands it runs, with each word
// evaluated as far as the hook can take it. This layer knows nothing about `gh`
// or `glab`: it answers what the shell would do, and the caller decides what
// that means for a PR body.

import sh, {
  type BinaryCmd,
  type CallExpr,
  type CmdSubst,
  type DblQuoted,
  type Lit,
  type Node,
  type ParamExp,
  type Redirect,
  type SglQuoted,
  type Stmt,
  type Word as SyntaxWord,
  type WordPart,
} from "mvdan-sh";

const { syntax } = sh;

/**
 * What a word evaluates to. A word holds a sequence of these, because the shell
 * builds one argument out of literal runs and expansions side by side
 * (`$TMPDIR/body.md`).
 */
export type WordSegment =
  | { kind: "literal"; text: string }
  /** A substitution whose whole job is reading a file: `$(cat f)`, `$(< f)`. */
  | { kind: "file"; path: string }
  /** An expansion the hook cannot evaluate, kept as source for the message. */
  | { kind: "unresolved"; source: string };

/** One argument, as written and as evaluated. */
export interface Word {
  source: string;
  segments: WordSegment[];
}

export interface Heredoc {
  /** Body text as the shell delivers it, with `<<-` tab stripping applied. */
  content: string;
  /** Sources of expansions the shell rewrites before the command sees the body. */
  expansions: string[];
}

export interface ShellCommand {
  /** The command and its arguments, after any env assignments. */
  argv: Word[];
  /** Names assigned ahead of the command (`GH_PAGER=cat gh pr ...`). */
  assigns: string[];
  /** Path this command truncates its stdout into. Null for `>>`, `2>`, and no redirect. */
  output: Word | null;
  /** Heredoc bodies fed to this command, in the order the shell delivers them. */
  heredocs: Heredoc[];
  /** True when the shell reaches this command only after an earlier one failed (`||`). */
  fallback: boolean;
  /** Shared by the stages of one pipeline. A command outside a pipeline has its own. */
  pipeline: number;
}

/** Text of a word the shell resolves to a plain string, or null when it does not. */
export function literal(word: Word | undefined): string | null {
  if (word === undefined) return null;
  let text = "";
  for (const segment of word.segments) {
    if (segment.kind !== "literal") return null;
    text += segment.text;
  }
  return text;
}

// Every node carries its own type name, so a predicate keyed on that name
// narrows as soundly as the parser itself does.
const isCall = (node: Node): node is CallExpr => syntax.NodeType(node) === "CallExpr";
const isStatement = (node: Node): node is Stmt => syntax.NodeType(node) === "Stmt";
const isLit = (node: Node): node is Lit => syntax.NodeType(node) === "Lit";
const isSingleQuoted = (node: Node): node is SglQuoted => syntax.NodeType(node) === "SglQuoted";
const isDoubleQuoted = (node: Node): node is DblQuoted => syntax.NodeType(node) === "DblQuoted";
const isParameter = (node: Node): node is ParamExp => syntax.NodeType(node) === "ParamExp";
const isSubstitution = (node: Node): node is CmdSubst => syntax.NodeType(node) === "CmdSubst";
const isBinary = (node: Node): node is BinaryCmd => syntax.NodeType(node) === "BinaryCmd";

// The parser exposes its operators as compile-time constants only, so each
// value is read back from a command whose operator is known. That stays correct
// across parser versions, where a copied literal would not.
function redirectOperatorOf(source: string): Redirect["Op"] | undefined {
  return syntax.NewParser().Parse(source, "probe.sh").Stmts[0]?.Redirs[0]?.Op;
}

const OPERATORS = {
  write: redirectOperatorOf("x > f"),
  heredoc: redirectOperatorOf("x <<E\nE"),
  dashHeredoc: redirectOperatorOf("x <<-E\nE"),
  input: redirectOperatorOf("x < f"),
};

function binaryOperatorOf(source: string): BinaryCmd["Op"] | undefined {
  const command = syntax.NewParser().Parse(source, "probe.sh").Stmts[0]?.Cmd;
  return command != null && isBinary(command) ? command.Op : undefined;
}

const OR_OPERATOR = binaryOperatorOf("x || y");
const PIPE_OPERATORS = new Set([binaryOperatorOf("x | y"), binaryOperatorOf("x |& y")]);

function sourceOf(node: Node, command: string): string {
  return command.slice(node.Pos().Offset(), node.End().Offset());
}

/** Half-open byte range a node covers in the command text. */
type Span = [number, number];

function spanOf(node: Node): Span {
  return [node.Pos().Offset(), node.End().Offset()];
}

function holds([start, end]: Span, offset: number): boolean {
  return offset >= start && offset < end;
}

interface Context {
  command: string;
  env: NodeJS.ProcessEnv;
}

// A `$(...)` or backtick run whose only job is reading a file, which is the one
// expansion the hook can follow: `cat f`, or a bare `< f` with no command.
function substitutedFile(substitution: CmdSubst, context: Context): string | null {
  const statements = substitution.Stmts.filter((statement) => statement !== null);
  const statement = statements.length === 1 ? statements[0] : undefined;
  if (statement === undefined) return null;
  const call = isCall(statement.Cmd) ? statement.Cmd : null;
  const args = (call?.Args ?? []).filter((arg) => arg !== null);
  if (args.length === 0) {
    const inputs = statement.Redirs.filter(
      (redirect) => redirect !== null && redirect.Op === OPERATORS.input,
    );
    const target = inputs.length === 1 ? inputs[0]?.Word : undefined;
    return target == null ? null : literal(evaluateWord(target, context));
  }

  const [verb, operand] = args;
  if (args.length !== 2 || verb == null || operand == null) return null;
  if (literal(evaluateWord(verb, context)) !== "cat") return null;
  return literal(evaluateWord(operand, context));
}

// A variable resolves from the environment the hook runs in, which is the
// environment the command will run in. An unset name stays unresolved rather
// than expanding to nothing, so the hook reports it instead of reading the
// wrong path.
function parameterSegment(expansion: ParamExp, context: Context): WordSegment {
  const source = sourceOf(expansion, context.command);
  const name = expansion.Param?.Value;
  const value = name == null ? undefined : context.env[name];
  const plain =
    !expansion.Excl && !expansion.Length && expansion.Slice == null && expansion.Repl == null;
  if (!plain || value == null) return { kind: "unresolved", source };
  return { kind: "literal", text: value };
}

// Double quotes protect everything but `$`, a backtick, and a quote of their
// own, so a backslash survives into the argument unless it precedes one of
// those or a newline. The parser hands the run back as written.
function unescapeQuoted(text: string): string {
  return text.replaceAll(/\\([$`"\\\n])/g, (_, escaped: string) =>
    escaped === "\n" ? "" : escaped,
  );
}

function partSegments(part: WordPart, context: Context, quoted = false): WordSegment[] {
  if (isLit(part))
    return [{ kind: "literal", text: quoted ? unescapeQuoted(part.Value) : part.Value }];
  if (isSingleQuoted(part)) return [{ kind: "literal", text: part.Value }];
  if (isDoubleQuoted(part))
    return part.Parts.flatMap((inner) => partSegments(inner, context, true));
  if (isParameter(part)) return [parameterSegment(part, context)];
  if (isSubstitution(part)) {
    const path = substitutedFile(part, context);
    if (path !== null) return [{ kind: "file", path }];
  }
  return [{ kind: "unresolved", source: sourceOf(part, context.command) }];
}

function evaluateWord(word: SyntaxWord, context: Context): Word {
  const segments: WordSegment[] = [];
  for (const part of word.Parts) {
    for (const segment of partSegments(part, context)) {
      const last = segments.at(-1);
      if (segment.kind === "literal" && last?.kind === "literal") last.text += segment.text;
      else segments.push({ ...segment });
    }
  }
  return { source: sourceOf(word, context.command), segments };
}

// A heredoc body reaches the CLI as written, so its literal runs are taken
// verbatim rather than evaluated. Any other part is an expansion the shell
// rewrites first, which is what a caller needs to be told about.
function heredocOf(redirect: Redirect, context: Context): Heredoc | null {
  if (redirect.Op !== OPERATORS.heredoc && redirect.Op !== OPERATORS.dashHeredoc) return null;
  const parts = redirect.Hdoc?.Parts ?? [];
  const content = parts
    .map((part) => (isLit(part) ? part.Value : sourceOf(part, context.command)))
    .join("");
  return {
    content: redirect.Op === OPERATORS.dashHeredoc ? stripLeadingTabs(content) : content,
    expansions: parts.filter((part) => !isLit(part)).map((part) => sourceOf(part, context.command)),
  };
}

// `<<-` drops leading tabs from every body line, including the one the closing
// delimiter sat on, which the parser leaves as a trailing run.
function stripLeadingTabs(content: string): string {
  return content
    .split("\n")
    .map((line) => line.replace(/^\t+/, ""))
    .join("\n");
}

// `>>` appends and `2>` is a different stream, so neither leaves the file
// holding just this command's output. The last write wins, as it does in the
// shell.
function outputOf(redirects: Redirect[], context: Context): Word | null {
  const write = redirects.findLast(
    (redirect) =>
      redirect.Op === OPERATORS.write && (redirect.N == null || redirect.N.Value === "1"),
  );
  const target = write?.Word;
  return target == null ? null : evaluateWord(target, context);
}

/** Where a command sits among the others, which the statement itself does not say. */
type Placement = Pick<ShellCommand, "fallback" | "pipeline">;

function statementCommand(
  statement: Stmt,
  context: Context,
  placement: Placement,
): ShellCommand | null {
  if (!isCall(statement.Cmd)) return null;
  const redirects = statement.Redirs.filter((redirect) => redirect !== null);
  return {
    ...placement,
    argv: statement.Cmd.Args.filter((arg) => arg !== null).map((arg) => evaluateWord(arg, context)),
    assigns: statement.Cmd.Assigns.filter((assign) => assign !== null).map(
      (assign) => assign.Name?.Value ?? "",
    ),
    output: outputOf(redirects, context),
    heredocs: redirects
      .map((redirect) => heredocOf(redirect, context))
      .filter((heredoc): heredoc is Heredoc => heredoc !== null),
  };
}

/**
 * The simple commands a shell command runs, in source order. The walk descends
 * into pipelines, subshells, brace groups, loops, and conditionals, so a
 * command is reached wherever it sits.
 *
 * Empty when the text is not valid shell, which is also when no shell would run
 * it, so a caller reading that as "nothing to act on" matches what happens.
 */
export function parseShell(command: string, env: NodeJS.ProcessEnv = process.env): ShellCommand[] {
  const context: Context = { command, env };
  const commands: ShellCommand[] = [];
  // Source spans of the `||` right operands and of the pipelines. A binary is
  // visited before the statements inside it, so by the time one of those is
  // reached its span is already here, and the outermost pipeline is first.
  const fallbacks: Span[] = [];
  const pipelines: Span[] = [];
  try {
    const file = syntax.NewParser().Parse(command, "command.sh");
    syntax.Walk(file, (node) => {
      // A command substitution belongs to the word that holds it, which
      // evaluates it on its own. It is not a step in this command's sequence.
      if (isSubstitution(node)) return false;
      if (isBinary(node)) {
        if (PIPE_OPERATORS.has(node.Op)) pipelines.push(spanOf(node));
        else if (node.Op === OR_OPERATOR && node.Y != null) fallbacks.push(spanOf(node.Y));
      }
      if (isStatement(node)) {
        const at = node.Pos().Offset();
        const found = statementCommand(node, context, {
          fallback: fallbacks.some((span) => holds(span, at)),
          pipeline: pipelines.find((span) => holds(span, at))?.[0] ?? at,
        });
        if (found !== null) commands.push(found);
      }
      return true;
    });
  } catch {
    return [];
  }
  return commands;
}
