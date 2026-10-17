import { spawnSync } from "node:child_process";
import { join } from "node:path";

// Runtime builtins only: install.sh bundles the stand-ins from a staged tree with no node_modules.

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

/** Where `install.sh` puts the stand-ins and each fixture writes its `meta.json`. */
export function dir(): string {
  return join(process.env.HOME ?? "", ".eval-stubs");
}

/** The case's snapshot, or undefined when the fixture skips it and the stand-ins only echo. */
export async function readSnapshot(): Promise<Fields | undefined> {
  const file = Bun.file(join(dir(), "meta.json"));
  if (!(await file.exists())) return undefined;
  return new Fields(await file.json(), "meta");
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Typed reads of a `meta.json` object, failing with the field's path when one is missing or mistyped. */
export class Fields {
  /** The object as the fixture wrote it, for fields served verbatim. */
  readonly raw: Record<string, unknown>;

  constructor(
    value: unknown,
    private readonly path: string,
  ) {
    if (!isRecord(value)) fail(`snapshot: ${path} must be an object`);
    this.raw = value;
  }

  private mistyped(key: string, type: string): never {
    return fail(`snapshot: ${this.path}.${key} must be a ${type}`);
  }

  string(key: string, fallback?: string): string {
    const v = this.raw[key];
    if (typeof v === "string") return v;
    return v === undefined && fallback !== undefined ? fallback : this.mistyped(key, "string");
  }

  number(key: string, fallback?: number): number {
    const v = this.raw[key];
    if (typeof v === "number") return v;
    return v === undefined && fallback !== undefined ? fallback : this.mistyped(key, "number");
  }

  boolean(key: string, fallback?: boolean): boolean {
    const v = this.raw[key];
    if (typeof v === "boolean") return v;
    return v === undefined && fallback !== undefined ? fallback : this.mistyped(key, "boolean");
  }

  /** A number, or null when the field is null or absent. */
  nullableNumber(key: string): number | null {
    return this.raw[key] == null ? null : this.number(key);
  }

  /** A string, or null when the field is null or absent. */
  nullableString(key: string): string | null {
    return this.raw[key] == null ? null : this.string(key);
  }

  has(key: string): boolean {
    return this.raw[key] !== undefined;
  }

  object(key: string): Fields {
    return new Fields(this.raw[key], `${this.path}.${key}`);
  }

  list(key: string, fallback?: []): Fields[] {
    const v = this.raw[key];
    if (v === undefined && fallback !== undefined) return [];
    if (!Array.isArray(v)) return this.mistyped(key, "list");
    return v.map((item, i) => new Fields(item, `${this.path}.${key}[${i}]`));
  }
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

/** `-f`/`-F` request fields as a map, reading `@file` values when `files` is set, as gh does. */
export function fields(args: Args, files = false): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of ["-f", "-F", "--field", "--raw-field"]) {
    for (const kv of args.flags.get(f) ?? []) {
      const eq = kv.indexOf("=");
      let value = kv.slice(eq + 1);
      if (files && value.startsWith("@")) {
        const read = spawnSync("cat", [value.slice(1)], { encoding: "utf8" });
        if (read.status !== 0) fail(`gh: open ${value.slice(1)}: no such file or directory`);
        value = read.stdout;
      }
      out.set(kv.slice(0, eq), value);
    }
  }
  return out;
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
