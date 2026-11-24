import { createHash } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { addedLines, type EditScope, type Hunk } from "./edit-scope";

/** Files above this size are never snapshotted or linted. */
const MAX_BYTES = 1024 * 1024;
/** The most commits one Bash call may add for the hook to lint what they touched. */
const MAX_FOLLOWED_COMMITS = 3;

const Entry = z.object({ size: z.number(), mtimeMs: z.number() });
const Manifest = z.object({
  head: z.string().nullable(),
  files: z.record(z.string(), Entry),
});
type Manifest = z.infer<typeof Manifest>;

export type Lints = (absolutePath: string) => Promise<boolean>;

export interface ChangedFile extends EditScope {
  path: string;
}

export type Detection =
  | { status: "changed"; files: ChangedFile[] }
  | { status: "no-repo" | "no-snapshot" | "head-reset" };

async function git(cwd: string, args: string[]): Promise<{ code: number; stdout: string }> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "ignore" });
  const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return { code, stdout };
}

export async function repoRoot(cwd: string): Promise<string | null> {
  if (cwd === "") return null;
  const { code, stdout } = await git(cwd, ["rev-parse", "--show-toplevel"]).catch(() => ({
    code: 1,
    stdout: "",
  }));
  return code === 0 ? stdout.trim() : null;
}

async function headOf(root: string): Promise<string | null> {
  const { code, stdout } = await git(root, ["rev-parse", "--verify", "-q", "HEAD"]);
  return code === 0 ? stdout.trim() : null;
}

function sha16(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}

function stateDir(sessionId: string, root: string): string {
  const safe = sessionId.replaceAll(/[^\w-]/g, "");
  return join(process.env.TMPDIR ?? tmpdir(), `writing-hooks-${safe}`, sha16(root));
}

function copyPath(dir: string, relative: string): string {
  return join(dir, "files", sha16(relative));
}

// `git status --porcelain -z` separates "XY path" entries with NUL. With renames off, every entry holds one path.
/** Repo-relative paths of modified, added, and untracked files that still exist, gitignored files left out. */
export async function dirtyFiles(root: string): Promise<string[]> {
  const { stdout } = await git(root, [
    "status",
    "--porcelain",
    "-z",
    "--untracked-files=all",
    "--no-renames",
  ]);
  return stdout
    .split("\0")
    .filter((entry) => entry.length > 3 && !entry.slice(0, 2).includes("D"))
    .map((entry) => entry.slice(3));
}

async function statOf(path: string): Promise<z.infer<typeof Entry> | null> {
  const info = await Bun.file(path)
    .stat()
    .catch(() => null);
  if (info === null || !info.isFile() || info.size > MAX_BYTES) return null;
  return { size: info.size, mtimeMs: info.mtimeMs };
}

async function readManifest(dir: string): Promise<Manifest | null> {
  const file = Bun.file(join(dir, "manifest.json"));
  if (!(await file.exists())) return null;
  return Manifest.safeParse(await file.json().catch(() => null)).data ?? null;
}

/** Record HEAD and copy each dirty file Vale lints, which gives the next detection its baseline. */
export async function snapshot(sessionId: string, cwd: string, lints: Lints): Promise<boolean> {
  const root = await repoRoot(cwd);
  if (root === null) return false;
  const dir = stateDir(sessionId, root);
  const previous = (await readManifest(dir))?.files ?? {};
  const files: Manifest["files"] = {};
  await mkdir(join(dir, "files"), { recursive: true });
  await Promise.all(
    (await dirtyFiles(root)).map(async (relative) => {
      const absolute = join(root, relative);
      if (!(await lints(absolute))) return;
      const entry = await statOf(absolute);
      if (entry === null) return;
      const known = previous[relative];
      const unchanged = known?.size === entry.size && known.mtimeMs === entry.mtimeMs;
      if (!unchanged || !(await Bun.file(copyPath(dir, relative)).exists())) {
        await Bun.write(copyPath(dir, relative), Bun.file(absolute));
      }
      files[relative] = entry;
    }),
  );
  const manifest: Manifest = { head: await headOf(root), files };
  await Bun.write(join(dir, "manifest.json"), JSON.stringify(manifest));
  return true;
}

// HEAD moved by at most a few new non-merge commits on top of the old one: commits this call made.
async function followedCommits(root: string, from: string, to: string): Promise<boolean> {
  const ancestor = await git(root, ["merge-base", "--is-ancestor", from, to]);
  if (ancestor.code !== 0) return false;
  const merges = await git(root, ["rev-list", "--merges", `${from}..${to}`]);
  if (merges.stdout.trim() !== "") return false;
  const count = await git(root, ["rev-list", "--count", `${from}..${to}`]);
  return Number(count.stdout.trim()) <= MAX_FOLLOWED_COMMITS;
}

async function committedText(root: string, head: string | null, relative: string): Promise<string> {
  if (head === null) return "";
  const { code, stdout } = await git(root, ["show", `${head}:${relative}`]);
  return code === 0 ? stdout : "";
}

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** The hunks of a unified diff, as `structuredPatch` shapes them. */
export function hunksOf(diff: string): Hunk[] {
  const hunks: Hunk[] = [];
  for (const line of diff.split("\n")) {
    const header = HUNK_HEADER.exec(line);
    if (header) hunks.push({ newStart: Number(header[1]), lines: [] });
    else if (/^[ +-]/.test(line) && !line.startsWith("+++") && !line.startsWith("---")) {
      hunks.at(-1)?.lines.push(line);
    }
  }
  return hunks;
}

async function scopeOf(dir: string, absolute: string, baseline: string): Promise<EditScope | null> {
  const current = await Bun.file(absolute).text();
  if (current === baseline) return null;
  const before = join(dir, "baseline", sha16(absolute));
  await Bun.write(before, baseline);
  const { stdout } = await git(dir, ["diff", "--no-index", "--no-color", "-U0", before, absolute]);
  await rm(before, { force: true });
  return { original: baseline, added: addedLines(hunksOf(stdout)) };
}

/** Files Vale lints whose content changed since the last snapshot, each with its content before and the lines added. */
export async function detectChanges(
  sessionId: string,
  cwd: string,
  lints: Lints,
): Promise<Detection> {
  const root = await repoRoot(cwd);
  if (root === null) return { status: "no-repo" };
  const dir = stateDir(sessionId, root);
  const manifest = await readManifest(dir);
  if (manifest === null) return { status: "no-snapshot" };

  const candidates = new Set<string>();
  const head = await headOf(root);
  if (head !== manifest.head) {
    if (manifest.head === null || head === null) return { status: "head-reset" };
    if (!(await followedCommits(root, manifest.head, head))) return { status: "head-reset" };
    const { stdout } = await git(root, ["diff", "--name-only", "-z", manifest.head, head]);
    for (const relative of stdout.split("\0")) if (relative !== "") candidates.add(relative);
  }

  const dirty = await dirtyFiles(root);
  const entries = await Promise.all(dirty.map((relative) => statOf(join(root, relative))));
  for (const [index, relative] of dirty.entries()) {
    const known = manifest.files[relative];
    const entry = entries[index];
    if (known?.size !== entry?.size || known?.mtimeMs !== entry?.mtimeMs) candidates.add(relative);
  }

  const scoped = await Promise.all(
    [...candidates].toSorted().map(async (relative): Promise<ChangedFile | null> => {
      const absolute = join(root, relative);
      if ((await statOf(absolute)) === null || !(await lints(absolute))) return null;
      const baseline =
        manifest.files[relative] === undefined
          ? await committedText(root, manifest.head, relative)
          : await Bun.file(copyPath(dir, relative)).text();
      const scope = await scopeOf(dir, absolute, baseline);
      return scope === null
        ? null
        : { path: absolute, original: scope.original, added: scope.added };
    }),
  );
  const files = scoped.filter((file) => file !== null);
  return { status: "changed", files };
}
