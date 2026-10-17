import { spawnSync } from "node:child_process";

/** The create and edit commands echo mode answers, per tool. */
const WRITES = { gh: ["pr create", "pr edit"], glab: ["mr create", "mr update"] } as const;

export type Tool = keyof typeof WRITES;

const TITLE = new Set(["-t", "--title"]);
const BODY = new Set(["-d", "--description", "-b", "--body"]);
const BODY_FILE = new Set(["-F", "--body-file", "--description-file"]);

function stdin(): string {
  return spawnSync("cat", { stdio: ["inherit", "pipe", "inherit"], encoding: "utf8" }).stdout;
}

/** Reads a file, or stdin for `-`, without trailing newlines, as `$(cat …)` would. */
function slurp(path: string): string {
  const text = path === "-" ? stdin() : spawnSync("cat", [path], { encoding: "utf8" }).stdout;
  return text.replace(/\n+$/, "");
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
 * post-run scorer reads, and fails every other command, as the network is unreachable.
 */
export function echo(tool: Tool, argv: string[]): never {
  const [cmd = "", sub = "", ...rest] = argv;
  if (!(WRITES[tool] as readonly string[]).includes(`${cmd} ${sub}`)) {
    process.stderr.write(`${tool} stand-in: ${argv.join(" ")} is unavailable offline\n`);
    process.exit(1);
  }
  const { title, body } = parseWrite(rest);
  const remote = spawnSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" });
  process.stdout.write(
    `PR-TITLE: ${title}\nPR-BODY-BEGIN\n${body}\nPR-BODY-END\n${requestUrl(tool, remote.stdout)}\n`,
  );
  process.exit(0);
}
