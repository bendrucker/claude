#!/usr/bin/env bun

import * as acorn from "acorn";

type Node = acorn.Node & Record<string, unknown>;

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

function walkNode(node: Node, visitor: (n: Node) => void): void {
  visitor(node);
  for (const key of Object.keys(node)) {
    const value = node[key];
    if (value && typeof value === "object" && "type" in (value as object)) {
      walkNode(value as Node, visitor);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object" && "type" in item) {
          walkNode(item as Node, visitor);
        }
      }
    }
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
    );
  }

  const violations: string[] = [];

  walkNode(ast as Node, (node) => {
    if (node.type !== "CallExpression") return;

    const callee = node.callee as Node;

    // Application.currentApplication() — always allowed
    if (
      callee.type === "MemberExpression" &&
      (callee.object as Node).type === "Identifier" &&
      (callee.object as Node).name === "Application" &&
      (callee.property as Node).type === "Identifier" &&
      (callee.property as Node).name === "currentApplication"
    ) {
      return;
    }

    // Application("SomeApp")
    if (callee.type === "Identifier" && callee.name === "Application") {
      const args = node.arguments as Node[];
      const firstArg = args[0];
      if (firstArg?.type === "Literal" && typeof firstArg.value === "string") {
        if (firstArg.value !== app) {
          violations.push(firstArg.value);
        }
      }
    }
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
// (-10004) and errAEEventNotHandled / "application isn't running" (-600). A retry
// clears them.
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

const RETRY_DELAY_MS = 300;

export async function runWithRetry(
  args: string[],
  run: (args: string[]) => Promise<RunResult>,
  sleep: (ms: number) => Promise<void> = Bun.sleep,
): Promise<RunResult> {
  const first = await run(args);
  if (first.code === 0 || !isRetriableAppleEventsError(first.code, first.stderr)) {
    return first;
  }
  await sleep(RETRY_DELAY_MS);
  return run(args);
}

if (import.meta.main) {
  const { cli } = await import("cleye");

  const argv = cli({
    name: "jxa",
    parameters: ["<app>"],
    flags: {
      expression: {
        type: String,
        alias: "e",
        description: "Inline JXA expression",
      },
    },
  });

  const app = argv._.app;
  const args = argv._.slice(1);

  let source: string;
  let osascriptArgs: string[];

  if (argv.flags.expression) {
    source = argv.flags.expression;
    osascriptArgs = ["-l", "JavaScript", "-e", source, ...args];
  } else {
    const scriptPath = args[0];
    if (!scriptPath) {
      console.error("Usage: bun jxa.ts <app> <script> [args...] or bun jxa.ts <app> -e '<expr>'");
      process.exit(1);
    }
    source = await Bun.file(scriptPath).text();
    osascriptArgs = ["-l", "JavaScript", scriptPath, ...args.slice(1)];
  }

  const result = validateAppScope(source, app);
  if (!result.valid) {
    console.error(
      `Blocked: script targets unauthorized application(s): ${result.violations.join(", ")}`,
    );
    console.error(`Only Application("${app}") is allowed`);
    process.exit(1);
  }

  const { code, stdout, stderr } = await runWithRetry(osascriptArgs, runOsascript);
  await Bun.write(Bun.stdout, stdout);
  await Bun.write(Bun.stderr, stderr);
  process.exit(code);
}
