import { spawnSync } from "node:child_process";
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
    await append(BRIEFS, `=== prompt for ${name} ===\n${argv.slice(dashes + 1).join(" ")}\n\n`);
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

export type Place = "pane" | "tab" | "bg";

function checkedOutBranch(worktree: string): string {
  const run = spawnSync("git", ["-C", worktree, "branch", "--show-current"], { encoding: "utf8" });
  const branch = run.status === 0 ? run.stdout.trim() : "";
  return branch === "" ? "unknown" : branch;
}

/**
 * Records a session opened in a worktree as `launch <branch> <path> place=<place>`, with
 * `title=<label>` when the multiplexer shows one, then the permissions it was given, one per line.
 */
export async function recordLaunch(worktree: string, place: Place, title?: string): Promise<void> {
  const fields = [`place=${place}`, ...(title === undefined ? [] : [`title=${title}`])];
  await appendLines([`launch ${checkedOutBranch(worktree)} ${worktree} ${fields.join(" ")}`]);
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

export interface Status {
  state: string;
  kind?: string;
  msg?: string;
}

function isStatus(value: unknown): value is Status {
  return (
    isObject(value) &&
    typeof value.state === "string" &&
    (value.kind === undefined || typeof value.kind === "string") &&
    (value.msg === undefined || typeof value.msg === "string")
  );
}

/** `session-status` holds a bare state or a JSON object with `kind` and `msg`. */
export async function status(): Promise<Status> {
  const file = Bun.file(join(stubDir, "session-status"));
  if (!(await file.exists())) return { state: "working" };
  const text = (await file.text()).trim();
  try {
    const parsed: unknown = JSON.parse(text);
    if (isStatus(parsed)) return parsed;
  } catch {
    // A bare state is not JSON.
  }
  return { state: text === "" ? "working" : text };
}

export function unavailable(cli: string, argv: string[]): never {
  process.stderr.write(`${cli} stand-in: ${argv.join(" ")} is unavailable offline\n`);
  process.exit(1);
}
