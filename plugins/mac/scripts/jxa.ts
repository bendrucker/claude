#!/usr/bin/env bun
// claude:dangerouslyDisableSandbox: hands off to osascript for JXA Apple Events, which the command sandbox blocks

import * as acorn from "acorn";
import { cli } from "cleye";
import { z } from "zod";

const AstNode = z.looseObject({ type: z.string() });
type AstNode = z.infer<typeof AstNode>;
const AnyList = z.array(z.unknown());

const Identifier = z.looseObject({ type: z.literal("Identifier"), name: z.string() });
const MemberExpression = z.looseObject({
  type: z.literal("MemberExpression"),
  object: AstNode,
  property: AstNode,
});
const CallExpression = z.looseObject({ type: z.literal("CallExpression"), callee: AstNode });
const StringLiteral = z.looseObject({ type: z.literal("Literal"), value: z.string() });

interface ValidationResult {
  valid: boolean;
  violations: string[];
}

function stripShebang(source: string): string {
  if (source.startsWith("#!")) {
    const newline = source.indexOf("\n");
    if (newline === -1) return "";
    return source.slice(newline + 1);
  }
  return source;
}

/** The nodes reachable from one property of a node: itself, or the ones in its list. */
function childNodes(value: unknown): AstNode[] {
  const items = AnyList.safeParse(value).data ?? [value];
  return items.flatMap((item) => AstNode.safeParse(item).data ?? []);
}

function walkNode(node: AstNode, visitor: (n: AstNode) => void): void {
  visitor(node);
  for (const value of Object.values(node)) {
    for (const child of childNodes(value)) walkNode(child, visitor);
  }
}

export function validateAppScope(source: string, app: string): ValidationResult {
  const stripped = stripShebang(source);
  let ast: acorn.Node;
  try {
    ast = acorn.parse(stripped, { ecmaVersion: 5, sourceType: "script" });
  } catch (error) {
    throw new Error(
      `Failed to parse JXA source: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  const violations: string[] = [];

  walkNode(AstNode.parse(ast), (node) => {
    const call = CallExpression.safeParse(node);
    if (!call.success) return;
    const callee = call.data.callee;

    // Application.currentApplication() — always allowed
    const member = MemberExpression.safeParse(callee).data;
    if (
      Identifier.safeParse(member?.object).data?.name === "Application" &&
      Identifier.safeParse(member?.property).data?.name === "currentApplication"
    ) {
      return;
    }

    // Application("SomeApp")
    if (Identifier.safeParse(callee).data?.name !== "Application") return;
    const first = StringLiteral.safeParse(AnyList.parse(node.arguments)[0]).data;
    if (first && first.value !== app) violations.push(first.value);
  });

  return { valid: violations.length === 0, violations };
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

// AppleEvents error codes that are safe to retry. They surface as transient XPC
// dispatcher hiccups on the first event after a cold session: errAEPrivilegeError
// (-10004) and errAEEventNotHandled / "application isn't running" (-600). Retries
// clear the transient case; a persistent failure (e.g. a sandbox deny) still
// surfaces after the final attempt.
const RETRIABLE_APPLE_EVENTS_CODES = [-10004, -600];

export function isRetriableAppleEventsError(exitCode: number, stderr: string): boolean {
  if (stderr.includes("Connection Invalid")) return true;
  return RETRIABLE_APPLE_EVENTS_CODES.some(
    (code) => exitCode === code || stderr.includes(`(${code})`),
  );
}

async function runOsascript(args: string[]): Promise<RunResult> {
  const proc = Bun.spawn(["osascript", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout, stderr };
}

const RETRY_DELAYS_MS = [300, 900];

export async function runWithRetry(
  args: string[],
  run: (args: string[]) => Promise<RunResult>,
  sleep: (ms: number) => Promise<void> = Bun.sleep,
): Promise<RunResult> {
  let result = await run(args);
  for (const delay of RETRY_DELAYS_MS) {
    if (result.code === 0 || !isRetriableAppleEventsError(result.code, result.stderr)) {
      return result;
    }
    await sleep(delay);
    result = await run(args);
  }
  return result;
}

// Forward osascript's output on the process streams. Bun.write(Bun.stdout, ...)
// is unsafe here: BunFile writes replace file contents, so when stdout and
// stderr share one capture file (`2>&1`) the stderr write truncates everything
// stdout just wrote. process.*.write appends at the fd offset, and setting
// exitCode instead of calling process.exit lets pending pipe writes flush.
export function emitResult({ code, stdout, stderr }: RunResult): void {
  process.stdout.write(stdout);
  process.stderr.write(stderr);
  process.exitCode = code;
}

export interface ParsedArgv {
  app: string;
  script?: string | undefined;
  expression?: string | undefined;
  args: string[];
}

// The runner's own flags bind ahead of the script path. Everything past it
// belongs to the target script, flags included, so cleye must not claim it.
// ignoreArgv leaves ignored elements in the array cleye parses, which makes
// those leftovers the verbatim argument list for the script.
export function parseArgv(argv: string[]): ParsedArgv {
  const args = [...argv];
  let positionals = 0;
  let expression = false;

  const parsed = cli(
    {
      name: "jxa",
      parameters: ["<app>", "[script]"],
      help: {
        description:
          "Run a JXA expression or script file scoped to one macOS app. Arguments after the script path pass to the script verbatim.",
      },
      flags: {
        expression: {
          type: String,
          alias: "e",
          description: "Inline JXA expression",
        },
      },
      ignoreArgv: (type: string, flagOrArgv: string) => {
        if (positionals >= (expression ? 1 : 2)) return true;
        // Left to cleye, a separator ahead of the script path would sweep the
        // script and its arguments into `_["--"]` and drop everything the
        // parameters do not name.
        if (type === "argument" && flagOrArgv === "--") return true;
        if (type === "known-flag") {
          if (flagOrArgv === "expression" || flagOrArgv === "e") expression = true;
        } else if (type === "argument") {
          positionals += 1;
        }
        return false;
      },
    },
    undefined,
    args,
  );

  // Callers that wrote an explicit `--` to force passthrough keep working: the
  // runner absorbs one separator so osascript never receives it as an argument.
  const separator = args.indexOf("--");
  if (separator !== -1) args.splice(separator, 1);

  return {
    app: parsed._.app,
    script: parsed._.script,
    expression: parsed.flags.expression,
    args,
  };
}

if (import.meta.main) {
  const { app, script, expression, args } = parseArgv(process.argv.slice(2));

  let source: string;
  let osascriptArgs: string[];

  if (expression) {
    source = expression;
    osascriptArgs = ["-l", "JavaScript", "-e", source, ...args];
  } else {
    if (!script) {
      console.error("Usage: bun jxa.ts <app> <script> [args...] or bun jxa.ts <app> -e '<expr>'");
      process.exit(1);
    }
    source = await Bun.file(script).text();
    osascriptArgs = ["-l", "JavaScript", script, ...args];
  }

  const result = validateAppScope(source, app);
  if (!result.valid) {
    console.error(
      `Blocked: script targets unauthorized application(s): ${result.violations.join(", ")}`,
    );
    console.error(`Only Application("${app}") is allowed`);
    process.exit(1);
  }

  emitResult(await runWithRetry(osascriptArgs, runOsascript));
}
