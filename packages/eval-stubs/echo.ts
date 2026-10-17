import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { dir } from "./snapshot";

/** The create and edit commands echo mode answers, per tool. */
const WRITES = { gh: ["pr create", "pr edit"], glab: ["mr create", "mr update"] } as const;

export type Tool = keyof typeof WRITES;

const TITLE = new Set(["-t", "--title"]);
const BODY = new Set(["-d", "--description", "-b", "--body"]);
const BODY_FILE = new Set(["-F", "--body-file", "--description-file"]);

function stdin(): string {
  return spawnSync("cat", { stdio: ["inherit", "pipe", "inherit"], encoding: "utf8" }).stdout;
}

/** Holds the last counted call's verdicts in the working tree, for a `{ source: file }` grader. */
export const VERDICTS = ".eval-verdicts";

/** A body under this many words is a probe, such as `--body "x"`, and records nothing. */
export const MIN_WORDS = 3;

/** Reads a file, or stdin for `-`, without trailing newlines, failing as gh does on an unreadable file. */
function slurp(path: string): string {
  if (path === "-") return stdin().replace(/\n+$/, "");
  const read = spawnSync("cat", [path], { encoding: "utf8" });
  if (read.status !== 0) {
    const reason = (read.stderr.trim().split(": ").at(-1) ?? "").toLowerCase();
    process.stderr.write(`${reason === "is a directory" ? "read" : "open"} ${path}: ${reason}\n`);
    process.exit(1);
  }
  return read.stdout.replace(/\n+$/, "");
}

/** Whether a call's verdicts count: not a `--dry-run`, and a body of at least {@link MIN_WORDS} words. */
export function counts(argv: string[], body: string): boolean {
  if (argv.includes("--dry-run")) return false;
  return body.split(/\s+/).filter((w) => w !== "").length >= MIN_WORDS;
}

/** The title and body a create or edit call carries, from any of its flag spellings. */
export function parseWrite(argv: string[]): { title: string; body: string } {
  let title = "";
  let body = "";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    const eq = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const name = eq > 0 ? arg.slice(0, eq) : arg;
    const inline = eq > 0 ? arg.slice(eq + 1) : undefined;
    const value = () => inline ?? argv[++i] ?? "";
    if (TITLE.has(name)) title = value();
    else if (BODY.has(name)) {
      const v = value();
      body = inline === undefined && v === "-" ? slurp("-") : v;
    } else if (BODY_FILE.has(name)) body = slurp(value());
  }
  return { title, body };
}

/** The URL the created request would get, from the origin remote's path. */
export function requestUrl(tool: Tool, remote: string): string {
  const path = remote
    .trim()
    .replace(/^[a-z+]+:\/\/[^/]+\//, "")
    .replace(/^[^@/]+@[^:]+:/, "")
    .replace(/\.git$/, "");
  return tool === "glab"
    ? `https://gitlab.com/${path}/-/merge_requests/1`
    : `https://github.com/${path}/pull/1`;
}

/**
 * Prints the title and body a create or edit call was given between markers a grader or a
 * post-run scorer reads, then the bundled check's verdict lines, and fails every other command,
 * as the network is unreachable. Offline, a create or edit prints only the verdicts and fails too.
 * A call whose verdicts count also writes them to {@link VERDICTS}, replacing any earlier ones.
 */
export async function echo(tool: Tool, argv: string[]): Promise<never> {
  const [cmd = "", sub = "", ...rest] = argv;
  if (!(WRITES[tool] as readonly string[]).includes(`${cmd} ${sub}`)) {
    process.stderr.write(`${tool} stand-in: ${argv.join(" ")} is unavailable offline\n`);
    process.exit(1);
  }
  const { title, body } = parseWrite(rest);
  const installed = readdirSync(dir());
  const verdicts = installed.includes("check.js") && counts(rest, body) ? checkLines(body) : "";
  if (verdicts !== "") await record(verdicts);
  if (installed.includes("offline")) {
    process.stdout.write(verdicts);
    process.stderr.write(`${tool} stand-in: ${cmd} ${sub} is unavailable offline\n`);
    process.exit(1);
  }
  const remote = spawnSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" });
  process.stdout.write(
    `PR-TITLE: ${title}\nPR-BODY-BEGIN\n${body}\nPR-BODY-END\n${requestUrl(tool, remote.stdout)}\n${verdicts}`,
  );
  process.exit(0);
}

/** Replaces the recorded verdicts, warning instead of failing the call when the file can't be written. */
async function record(verdicts: string): Promise<void> {
  const file = join(dirname(dir()), "cwd", VERDICTS);
  try {
    await Bun.write(file, verdicts);
  } catch (error) {
    process.stderr.write(`stand-in: could not record verdicts in ${file}: ${String(error)}\n`);
  }
}

interface Check {
  default: (body: string) => string[];
}

function isCheck(m: unknown): m is Check {
  return typeof m === "object" && m !== null && "default" in m && typeof m.default === "function";
}

/** The verdict lines the module `install.sh --check` bundled prints for a body. */
function checkLines(body: string): string {
  const check: unknown = import.meta.require(join(dir(), "check.js"));
  if (!isCheck(check)) throw new Error("check.js has no default export function");
  return check
    .default(body)
    .map((line) => `${line}\n`)
    .join("");
}
