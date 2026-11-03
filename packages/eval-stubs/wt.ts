import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { record, unavailable } from "./calls";

const argv = process.argv.slice(2);
await record("wt", argv);

function git(root: string, args: string[]): { code: number; out: string; err: string } {
  const run = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  return { code: run.status ?? 1, out: run.stdout, err: run.stderr };
}

/** The path of the worktree that has the branch checked out, from the porcelain listing. */
function checkedOut(root: string, branch: string): string | undefined {
  let path: string | undefined;
  for (const line of git(root, ["worktree", "list", "--porcelain"]).out.split("\n")) {
    if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
    if (line === `branch refs/heads/${branch}`) return path;
  }
  return undefined;
}

function print(value: unknown): never {
  process.stdout.write(`${JSON.stringify(value)}\n`);
  process.exit(0);
}

const flag = (name: string) => argv[argv.indexOf(name) + 1];

if (argv[0] !== "-C" || argv[2] !== "switch") unavailable("wt", argv);
const root = argv[1] ?? "";
const rest = argv.slice(3);
const creating = rest[0] === "--create";
const branch = (creating ? rest[1] : rest[0]) ?? "";
if (branch === "" || branch.startsWith("-") || /^(pr|mr):/.test(branch)) unavailable("wt", argv);

const existing = checkedOut(root, branch);
if (existing !== undefined)
  print({ action: "existing", branch, path: existing, created_branch: false });

const path = join(root, ".worktrees", branch);
const add = creating
  ? git(root, ["worktree", "add", "-q", "--no-track", "-b", branch, path, flag("--base") ?? "HEAD"])
  : git(root, ["worktree", "add", "-q", path, branch]);
if (add.code !== 0) {
  process.stderr.write(add.err);
  process.exit(1);
}
print({ action: "created", branch, path, created_branch: creating });
