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

  const proc = Bun.spawn(["osascript", ...osascriptArgs], {
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  process.exit(code);
}
