import { readFileSync } from "node:fs";
import { type File, parse } from "sh-syntax";

// sh-syntax WASM bridge returns `Stmt` at runtime but TS types declare `Stmts`
type RuntimeFile = Omit<File, "Stmts"> & { Stmt?: File["Stmts"] };

function toRuntimeFile(parsed: File): RuntimeFile {
  return parsed as RuntimeFile;
}

export function hasBashCommand(input: unknown): input is { command: string } {
  return (
    typeof input === "object" &&
    input !== null &&
    "command" in input &&
    typeof (input as { command: unknown }).command === "string"
  );
}

export async function extractMarkdownFromBash(
  command: string,
  label = "shell-extract",
): Promise<string | null> {
  const bodyFileMatch = command.match(/--body-file[=\s](\S+)/);
  if (bodyFileMatch) {
    try {
      return readFileSync(bodyFileMatch[1]!, "utf-8");
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      // ENOENT is expected when the hook fires before the file is written
      if (err.code !== "ENOENT") {
        console.error(`[${label}] Failed to read body file ${bodyFileMatch[1]}: ${err.message}`);
      }
      return null;
    }
  }

  try {
    return await extractHeredoc(command, label);
  } catch (error) {
    console.error(
      `[${label}] Failed to extract heredoc: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

const MIN_CONTENT_LENGTH = 80;

export function extractMarkdownFromMcp(input: unknown): string | null {
  if (typeof input !== "object" || input === null) return null;
  const obj = input as Record<string, unknown>;

  for (const value of Object.values(obj)) {
    if (typeof value !== "string") continue;
    if (value.includes("\n") || value.length >= MIN_CONTENT_LENGTH) return value;
  }

  return null;
}

async function extractHeredoc(command: string, label: string): Promise<string | null> {
  const ast = toRuntimeFile(await parse(command));

  const topLevel = findHdocLit(ast);
  if (topLevel) return topLevel;

  // sh-syntax WASM bridge doesn't expose nested CallExpr args.
  // Extract inner commands from $(...) substitutions and re-parse.
  for (const stmt of ast.Stmt ?? []) {
    if (!stmt.Cmd) continue;
    const cmdText = command.slice(stmt.Cmd.Pos.Offset, stmt.Cmd.End.Offset);
    const csStart = cmdText.indexOf("$(");
    if (csStart === -1) continue;

    let depth = 0;
    let csEnd = -1;
    for (let i = csStart; i < cmdText.length; i++) {
      if (cmdText[i] === "$" && cmdText[i + 1] === "(") {
        depth++;
        i++;
      } else if (cmdText[i] === ")") {
        depth--;
        if (depth === 0) {
          csEnd = i;
          break;
        }
      }
    }

    if (csEnd === -1) continue;
    const innerCmd = cmdText.slice(csStart + 2, csEnd);

    try {
      const innerAst = toRuntimeFile(await parse(innerCmd));
      const nested = findHdocLit(innerAst);
      if (nested) return nested;
    } catch (error) {
      console.error(
        `[${label}] Failed to parse inner command: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return null;
}

function findHdocLit(ast: RuntimeFile): string | null {
  for (const stmt of ast.Stmt ?? []) {
    for (const redir of stmt.Redirs ?? []) {
      if (redir.Hdoc?.Lit) return redir.Hdoc.Lit;
    }
  }
  return null;
}
