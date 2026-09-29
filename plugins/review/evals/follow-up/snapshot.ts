import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { z } from "zod";

function run(cmd: string, args: string[], cwd: string): string {
  const out = spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (out.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed: ${out.stderr}`);
  return out.stdout;
}

export function fail(message: string, code = 1): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

export function refuse(tool: string, what: string): never {
  return fail(
    `${tool}: ${what} is disabled. This environment is a read-only snapshot of the review.`,
  );
}

/** Where `stubs.sh` installs the stand-ins and each fixture writes its `meta.json`. */
export const DIR = join(process.env.HOME ?? "", ".review-snapshot");

/** Reads the case's snapshot. `root` is the scaffolded repository the diffs come from. */
export async function load<T extends z.ZodObject>(
  schema: T,
): Promise<z.output<T> & { root: string }> {
  const file = Bun.file(join(DIR, "meta.json"));
  if (!(await file.exists())) return fail(`no review snapshot at ${DIR}`);
  const Root = z.object({ root: z.string() });
  const data: unknown = JSON.parse(await file.text());
  const meta: z.output<T> = schema.parse(data);
  return { ...meta, root: Root.parse(data).root };
}

export function git(root: string, ...args: string[]): string {
  return run("git", args, root);
}

/** Prints JSON the way gh and glab do when piped, through `jq -r` when a filter is given. */
export function emit(value: unknown, filter?: string): void {
  const text = JSON.stringify(value);
  if (filter === undefined) {
    process.stdout.write(`${text}\n`);
    return;
  }
  const out = spawnSync("jq", ["-r", filter], { input: text, encoding: "utf8" });
  if (out.status !== 0) fail(out.stderr.trim());
  process.stdout.write(out.stdout);
}

export interface Args {
  positional: string[];
  flags: Map<string, string[]>;
}

/** Splits argv into positionals and flags. Flags named in `booleans` stand alone, and every other flag consumes the next argument. */
export function parseArgs(argv: string[], booleans: Set<string>): Args {
  const positional: string[] = [];
  const flags = new Map<string, string[]>();
  const add = (k: string, v: string) => flags.set(k, [...(flags.get(k) ?? []), v]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    const eq = arg.indexOf("=");
    if (!arg.startsWith("-") || arg === "-") positional.push(arg);
    else if (arg.startsWith("--") && eq > 0) add(arg.slice(0, eq), arg.slice(eq + 1));
    else if (booleans.has(arg)) add(arg, "true");
    else add(arg, argv[++i] ?? "");
  }
  return { positional, flags };
}

export function flag(args: Args, ...names: string[]): string | undefined {
  for (const n of names) {
    const v = args.flags.get(n);
    if (v !== undefined) return v.at(-1);
  }
  return undefined;
}

export function has(args: Args, ...names: string[]): boolean {
  return names.some((n) => args.flags.has(n));
}

export interface FileDiff {
  oldPath: string;
  newPath: string;
  status: "added" | "removed" | "modified" | "renamed";
  additions: number;
  deletions: number;
  /** Hunks only, from the first `@@` line, as both APIs return them. */
  patch: string;
}

const STATUS: Record<string, FileDiff["status"]> = { A: "added", D: "removed", R: "renamed" };

export function fileDiffs(root: string, from: string, to: string): FileDiff[] {
  const statuses = git(root, "diff", "--name-status", "-M", from, to).trim().split("\n");
  const numstat = git(root, "diff", "--numstat", "-M", from, to).trim().split("\n");
  return statuses
    .filter((l) => l !== "")
    .map((line, i) => {
      const [code = "M", a = "", b] = line.split("\t");
      const newPath = b ?? a;
      const [add = "0", del = "0"] = (numstat[i] ?? "").split("\t");
      const full = git(root, "diff", "-M", from, to, "--", ...new Set([a, newPath]));
      const at = full.indexOf("\n@@");
      return {
        oldPath: a,
        newPath,
        status: STATUS[code.charAt(0)] ?? "modified",
        additions: Number(add),
        deletions: Number(del),
        patch: at === -1 ? "" : full.slice(at + 1),
      };
    });
}

export interface Commit {
  sha: string;
  author: string;
  email: string;
  date: string;
  message: string;
}

export function commits(root: string, from: string, to: string): Commit[] {
  const raw = git(
    root,
    "log",
    "--reverse",
    "--format=%H%x1f%an%x1f%ae%x1f%aI%x1f%B%x1e",
    `${from}..${to}`,
  );
  return raw
    .split("\x1e")
    .map((r) => r.trim())
    .filter((r) => r !== "")
    .map((r) => {
      const [sha = "", author = "", email = "", date = "", message = ""] = r.split("\x1f");
      return { sha, author, email, date, message: message.trim() };
    });
}
