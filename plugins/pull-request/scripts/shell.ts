// A shell command as the list of simple commands it runs, with each word
// evaluated as far as the hook can take it.

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
  type Subshell,
  type Word as SyntaxWord,
  type WordPart,
} from "mvdan-sh";

const { syntax } = sh;

/** A word holds a sequence of these, since `$TMPDIR/body.md` is one argument. */
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
  /** Byte range of the raw body (before `<<-` stripping) in the command text. */
  span: Span;
  /** `<<-`: its tab-stripped `content` no longer matches `span`, so it cannot be spliced back verbatim. */
  dash: boolean;
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

const isCall = (node: Node): node is CallExpr => syntax.NodeType(node) === "CallExpr";
const isStatement = (node: Node): node is Stmt => syntax.NodeType(node) === "Stmt";
const isLit = (node: Node): node is Lit => syntax.NodeType(node) === "Lit";
const isSingleQuoted = (node: Node): node is SglQuoted => syntax.NodeType(node) === "SglQuoted";
const isDoubleQuoted = (node: Node): node is DblQuoted => syntax.NodeType(node) === "DblQuoted";
const isParameter = (node: Node): node is ParamExp => syntax.NodeType(node) === "ParamExp";
const isSubstitution = (node: Node): node is CmdSubst => syntax.NodeType(node) === "CmdSubst";
const isBinary = (node: Node): node is BinaryCmd => syntax.NodeType(node) === "BinaryCmd";
const isSubshell = (node: Node): node is Subshell => syntax.NodeType(node) === "Subshell";

// The parser exposes its operators as compile-time constants only, so each is
// read back from a command whose operator is known.
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

// The parser reports positions as byte offsets into the UTF-8 encoding of the
// command, which run ahead of the matching JS string index once any character
// before the offset is multi-byte. Every offset that indexes into `command`
// with `.slice()` goes through this first.
function byteOffsetToIndex(command: string, byteOffset: number): number {
  if (Buffer.byteLength(command) === command.length) return byteOffset;
  return Buffer.from(command, "utf8").subarray(0, byteOffset).toString("utf8").length;
}

function sourceOf(node: Node, command: string): string {
  const start = byteOffsetToIndex(command, node.Pos().Offset());
  const end = byteOffsetToIndex(command, node.End().Offset());
  return command.slice(start, end);
}

/** Half-open byte range a node covers in the command text. */
export type Span = [number, number];

function spanOf(node: Node): Span {
  return [node.Pos().Offset(), node.End().Offset()];
}

function holds([start, end]: Span, offset: number): boolean {
  return offset >= start && offset < end;
}

/** `text` with the byte range `span` replaced by `replacement`. */
export function splice(text: string, [start, end]: Span, replacement: string): string {
  return text.slice(0, start) + replacement + text.slice(end);
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

// An unset name stays unresolved rather than expanding to nothing, so a caller
// reports it instead of reading the wrong path.
function parameterSegment(expansion: ParamExp, context: Context): WordSegment {
  const source = sourceOf(expansion, context.command);
  const name = expansion.Param?.Value;
  const value = name == null ? undefined : context.env[name];
  const plain =
    !expansion.Excl && !expansion.Length && expansion.Slice == null && expansion.Repl == null;
  if (!plain || value == null) return { kind: "unresolved", source };
  return { kind: "literal", text: value };
}

// The parser hands back the run as written. A backslash survives into the
// argument unless it precedes one of the characters quoting cannot protect.
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

// A heredoc body reaches the CLI as written, so literal runs are taken
// verbatim. Any other part is an expansion the shell rewrites first.
//
// The node's own `.End()` (on the `Hdoc` word and on each part) reaches past
// the body to cover the closing delimiter, so the span is built from `.Pos()`
// plus the raw content's length instead.
function heredocOf(redirect: Redirect, context: Context): Heredoc | null {
  if (redirect.Op !== OPERATORS.heredoc && redirect.Op !== OPERATORS.dashHeredoc) return null;
  const parts = redirect.Hdoc?.Parts ?? [];
  const raw = parts
    .map((part) => (isLit(part) ? part.Value : sourceOf(part, context.command)))
    .join("");
  const start = byteOffsetToIndex(context.command, redirect.Hdoc?.Pos().Offset() ?? 0);
  const dash = redirect.Op === OPERATORS.dashHeredoc;
  return {
    content: dash ? stripLeadingTabs(raw) : raw,
    expansions: parts.filter((part) => !isLit(part)).map((part) => sourceOf(part, context.command)),
    span: [start, start + raw.length],
    dash,
  };
}

// `<<-` also strips the closing delimiter's own indent, which the parser leaves
// as a trailing run.
function stripLeadingTabs(content: string): string {
  return content
    .split("\n")
    .map((line) => line.replace(/^\t+/, ""))
    .join("\n");
}

// `>>` appends and `2>` is a different stream, so neither leaves the file
// holding just this command's output.
function outputOf(redirects: Redirect[], context: Context): Word | null {
  const write = redirects.findLast(
    (redirect) =>
      redirect.Op === OPERATORS.write && (redirect.N == null || redirect.N.Value === "1"),
  );
  const target = write?.Word;
  return target == null ? null : evaluateWord(target, context);
}

// A bare assignment statement (`P=foo`, no command) sets a shell variable that
// later statements in the same call see, unlike an assignment prefixing a
// command (`GH_PAGER=cat gh pr view`), which is scoped to that command alone.
// Only a literal value is threaded forward; one the hook cannot evaluate
// leaves the name as the caller already had it, rather than clearing it.
function applyBareAssignments(call: CallExpr, context: Context): void {
  if (call.Args.some((arg) => arg !== null)) return;
  for (const assign of call.Assigns) {
    if (assign === null) continue;
    const name = assign.Name?.Value;
    if (name === undefined || name === "") continue;
    const value = assign.Value === null ? "" : literal(evaluateWord(assign.Value, context));
    if (value !== null) context.env[name] = value;
  }
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
 * The simple commands a shell command runs, in source order, wherever they sit.
 * Empty when the text is not valid shell, which is also when no shell would run
 * it.
 */
export function parseShell(command: string, env: NodeJS.ProcessEnv = process.env): ShellCommand[] {
  // Copied so a bare assignment's forwarding (below) never writes into the
  // caller's environment, which defaults to the real `process.env`.
  const context: Context = { command, env: { ...env } };
  const commands: ShellCommand[] = [];
  // A binary is visited before the statements inside it, so a statement's spans
  // are already here, outermost first.
  const fallbacks: Span[] = [];
  const pipelines: Span[] = [];
  // A subshell runs in a copy of the shell, so an assignment inside `(...)`
  // never reaches a sibling statement outside it. Visited outermost first,
  // same as the pipeline/fallback spans above.
  const subshells: Span[] = [];
  try {
    const file = syntax.NewParser().Parse(command, "command.sh");
    syntax.Walk(file, (node) => {
      // The word holding it evaluates it, so it is no step in this sequence.
      if (isSubstitution(node)) return false;
      if (isSubshell(node)) subshells.push(spanOf(node));
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
        if (isCall(node.Cmd) && !subshells.some((span) => holds(span, at))) {
          applyBareAssignments(node.Cmd, context);
        }
      }
      return true;
    });
  } catch {
    // The doc comment above already covers this: unparseable shell runs
    // nothing, so an empty command list is the correct answer, not a bug.
    return [];
  }
  return commands;
}
