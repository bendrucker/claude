#!/usr/bin/env bun

import { join } from "node:path";
import type { Code } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { visit } from "unist-util-visit";
import { readTracked, runCheck, tracked } from "./check";

const root = join(import.meta.dirname, "..");

// Embedded JS/TS is illustrative, not runnable: fences routinely use top-level
// await, export, and undefined globals. Bun.Transpiler in module mode checks
// syntax only. It tolerates all of that but throws on a genuine syntax error.
type Loader = "js" | "jsx" | "ts" | "tsx";

const LOADERS: Record<string, Loader> = {
  js: "js",
  javascript: "js",
  jsx: "jsx",
  ts: "ts",
  typescript: "ts",
  tsx: "tsx",
};

const transpilers = new Map<Loader, Bun.Transpiler>();

function transpilerFor(loader: Loader): Bun.Transpiler {
  let transpiler = transpilers.get(loader);
  if (!transpiler) {
    transpiler = new Bun.Transpiler({ loader });
    transpilers.set(loader, transpiler);
  }
  return transpiler;
}

function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n")[0]?.trim() ?? "Parse error";
}

function checkBlock(node: Code): string | null {
  const lang = node.lang?.toLowerCase();
  if (!lang) return null;

  // A `fragment` token in the info string opts a deliberately-partial or
  // multi-example block out of single-module parsing.
  if (node.meta?.split(/\s+/).includes("fragment")) return null;

  if (lang === "json") {
    try {
      JSON.parse(node.value);
      return null;
    } catch (error) {
      return firstLine(error);
    }
  }

  const loader = LOADERS[lang];
  if (!loader) return null;

  try {
    transpilerFor(loader).transformSync(node.value);
    return null;
  } catch (error) {
    return firstLine(error);
  }
}

export async function checkFile(file: string): Promise<string[]> {
  const text = await readTracked(file, root);
  if (text === null) return [];

  const ast = fromMarkdown(text);
  const violations: string[] = [];

  visit(ast, "code", (node: Code) => {
    const error = checkBlock(node);
    if (error === null) return;
    const line = node.position?.start.line ?? 0;
    violations.push(`${file}:${line} [${node.lang}] ${error}`);
  });

  return violations;
}

export async function findViolations(): Promise<string[]> {
  const results = await Promise.all((await tracked("*.md", root)).map(checkFile));
  return results.flat();
}

if (import.meta.main) {
  await runCheck(
    async () => ({
      header: "Fenced code blocks with syntax errors (tag the fence `fragment` to skip):",
      violations: await findViolations(),
    }),
    { success: "All fenced JS/TS/JSON code blocks parse" },
  );
}
