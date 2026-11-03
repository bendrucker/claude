// Concurrent stand-ins need O_APPEND atomicity, which Bun.write lacks.
// oxlint-disable-next-line no-restricted-imports
import { appendFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const stubDir = join(homedir(), ".eval-stubs");

const CALLS = ".eval-calls";
const BRIEFS = ".eval-briefs.md";

async function append(name: string, text: string): Promise<void> {
  await appendFile(join(homedir(), "cwd", name), text);
}

async function appendLines(lines: string[]): Promise<void> {
  await append(CALLS, lines.map((line) => `${line}\n`).join(""));
}

/**
 * Appends the call as `<cli> <argv>` to the file graders read, before the stand-in answers or
 * fails. A launched command's prompt, the word after its last `--`, moves to the briefs file.
 */
export async function record(cli: string, argv: string[]): Promise<void> {
  const flat = argv.map((word) => word.replaceAll("\n", " "));
  const dashes = argv.lastIndexOf("--");
  let shown = flat;
  if (dashes !== -1 && dashes < argv.length - 1) {
    const name = argv[argv.indexOf("--name") + 1] ?? "unknown";
    shown = [...flat.slice(0, dashes + 1), "<prompt>"];
    await append(BRIEFS, `## ${name}\n\n${argv.slice(dashes + 1).join(" ")}\n\n`);
  }
  await appendLines([[cli, ...shown].join(" ")]);
}

interface Settings {
  permissions?: { allow?: string[] };
  sandbox?: { filesystem?: { allowWrite?: string[] } };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isSettings(value: unknown): value is Settings {
  if (!isObject(value)) return false;
  const { permissions, sandbox } = value;
  if (permissions !== undefined) {
    if (!isObject(permissions)) return false;
    if (permissions.allow !== undefined && !isStrings(permissions.allow)) return false;
  }
  if (sandbox !== undefined) {
    if (!isObject(sandbox)) return false;
    const { filesystem } = sandbox;
    if (filesystem !== undefined) {
      if (!isObject(filesystem)) return false;
      if (filesystem.allowWrite !== undefined && !isStrings(filesystem.allowWrite)) return false;
    }
  }
  return true;
}

/** Records a session opened in a worktree, then the permissions it was given, one line per rule. */
export async function recordLaunch(branch: string, worktree: string): Promise<void> {
  await appendLines([`launch ${branch} ${worktree}`]);
  const file = Bun.file(join(worktree, ".claude/settings.local.json"));
  if (!(await file.exists())) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return;
  }
  if (!isSettings(parsed)) return;
  await appendLines([
    ...(parsed.permissions?.allow ?? []).map((rule) => `allow ${rule}`),
    ...(parsed.sandbox?.filesystem?.allowWrite ?? []).map((path) => `sandbox-write ${path}`),
  ]);
}

export function unavailable(cli: string, argv: string[]): never {
  process.stderr.write(`${cli} stand-in: ${argv.join(" ")} is unavailable offline\n`);
  process.exit(1);
}
