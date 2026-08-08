import { homedir } from "node:os";
import { basename, extname, isAbsolute, join } from "node:path";
import { commandTokens, splitSegments } from "./command";

const SCRIPT_INTERPRETERS = new Set(["bun", "node"]);
/** Gating on extensions keeps the hook from reading the head of every binary it sees. */
const SCRIPT_EXTENSIONS = new Set([".ts", ".js", ".mjs", ".cjs", ".sh"]);
/** Interpreter subcommands that precede the script path rather than being it. */
const INTERPRETER_SUBCOMMANDS = new Set(["run", "x", "exec"]);
const SCRIPT_MARKER = "claude:dangerouslyDisableSandbox";
const HEAD_BYTES = 65_536;

/**
 * Script paths a command hands to an interpreter, or runs directly, matching the `mac`
 * plugin's marker hook. Reimplemented rather than imported, because that plugin resolves to
 * a cache path at runtime and no import edge from user hooks reaches it. Detection here is
 * the broader of the two (newline-separated segments, `bun run <script>`, flags before the
 * path), so a marked script is never missed on this side.
 */
export function scriptArguments(command: string): string[] {
  const scripts: string[] = [];

  for (const segment of splitSegments(command)) {
    const tokens = commandTokens(segment);
    const token = tokens[0];
    if (!token) continue;

    const name = basename(token);
    if (SCRIPT_INTERPRETERS.has(name)) {
      const script = tokens
        .slice(1)
        .find((argument) => !argument.startsWith("-") && !INTERPRETER_SUBCOMMANDS.has(argument));
      if (script) scripts.push(script);
    } else if (SCRIPT_EXTENSIONS.has(extname(name))) {
      scripts.push(token);
    }
  }

  return scripts;
}

async function hasMarker(path: string): Promise<boolean> {
  try {
    const head = await Bun.file(path).slice(0, HEAD_BYTES).text();
    return head.includes(SCRIPT_MARKER);
  } catch {
    return false;
  }
}

function resolveScript(script: string, cwd?: string): string {
  const unquoted = script.replace(/^['"]|['"]$/g, "");
  if (unquoted.startsWith("~/")) return join(homedir(), unquoted.slice(2));
  if (isAbsolute(unquoted) || !cwd) return unquoted;
  return join(cwd, unquoted);
}

/** Whether the command runs a script that opts itself out of the sandbox by marker comment. */
export async function hasMarkedScript(command: string, cwd?: string): Promise<boolean> {
  for (const script of scriptArguments(command)) {
    if (await hasMarker(resolveScript(script, cwd))) return true;
  }
  return false;
}
