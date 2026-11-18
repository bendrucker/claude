import { mkdir, rm } from "node:fs/promises";
import { basename, dirname, extname, join, relative } from "node:path";
import { z } from "zod";

export const VALE_CONFIG = join(import.meta.dirname, "..", ".vale.ini");

/** Where text came from, which picks the `.vale.ini` section that lints it. */
export type ValeSource = { filePath: string } | { kind: "body" | "commit" | "review" };

export const Alert = z.object({
  Check: z.string(),
  Message: z.string(),
  Severity: z.enum(["error", "warning", "suggestion"]),
  Line: z.number(),
  Span: z.tuple([z.number(), z.number()]),
  Match: z.string(),
});
const Output = z.record(z.string(), z.array(Alert));

export type ValeAlert = z.infer<typeof Alert>;

/** A Vale runtime failure, carrying the E1xx/E2xx code Vale printed when it printed one. */
export class ValeError extends Error {
  readonly code: string | undefined;
  constructor(exitCode: number, output: string) {
    super(`vale exited ${exitCode}: ${output}`);
    this.name = "ValeError";
    this.code = /"Code":\s*"(E\d+)"/.exec(output)?.[1];
  }
}

export function valeBinary(): string | null {
  const onPath = Bun.which("vale");
  if (onPath !== null) return onPath;
  const data = process.env.CLAUDE_PLUGIN_DATA;
  if (data === undefined || data === "") return null;
  const bundled = join(data, "bin", "vale");
  return Bun.which(bundled) ?? null;
}

const KIND_EXTENSIONS = { body: ".prbody", commit: ".commitmsg", review: ".reviewbody" } as const;

// A file goes by its path relative to the config root, which is what a
// directory-scoped section such as `[docs/*.md]` matches against.
function sourceArg(source: ValeSource, root: string | null): string {
  if ("kind" in source) return `--ext=${KIND_EXTENSIONS[source.kind]}`;
  const path = root === null ? basename(source.filePath) : relative(root, source.filePath);
  return `--path=${path}`;
}

const PluginManifest = z.object({ name: z.string() });

// A checkout or worktree of this plugin has its own `.vale.ini` but lacks the packages it syncs.
async function isPluginCopy(dir: string): Promise<boolean> {
  const manifest = Bun.file(join(dir, ".claude-plugin", "plugin.json"));
  if (!(await manifest.exists())) return false;
  return PluginManifest.safeParse(await manifest.json().catch(() => null)).data?.name === "writing";
}

/** The directory of the nearest `.vale.ini` or `_vale.ini` above `filePath`, if a repo adopted Vale. */
export async function repoConfigRoot(filePath: string): Promise<string | null> {
  const ancestors: string[] = [];
  for (let dir = dirname(filePath); ; dir = dirname(dir)) {
    ancestors.push(dir);
    if (dirname(dir) === dir) break;
  }
  const adopted = await Promise.all(
    ancestors.map(async (dir) => {
      const exists = await Promise.all(
        [".vale.ini", "_vale.ini"].map((name) => Bun.file(join(dir, name)).exists()),
      );
      return exists.some(Boolean) && !(await isPluginCopy(dir));
    }),
  );
  return ancestors[adopted.indexOf(true)] ?? null;
}

/** The extensions the config's `[*.ext]` and `[*.{a,b}]` sections match, or null when a section is any other glob. */
export function sectionExtensions(ini: string): Set<string> | null {
  const extensions = new Set<string>();
  for (const [, header = ""] of ini.matchAll(/^\[([^\]]+)\]\s*$/gm)) {
    if (header === "formats") continue;
    // `*.md` or `*.{md,ts}`: the extension, or the braced list.
    const glob = /^\*\.(?:\{([\w,]+)\}|(\w+))$/.exec(header);
    if (glob === null) return null;
    for (const ext of (glob[1] ?? glob[2] ?? "").split(",")) extensions.add(ext);
  }
  return extensions;
}

let pluginExtensions: Promise<Set<string> | null> | undefined;

// Vale returns nothing for an extension outside every section, so skip the spawn. A repo's own config
// merges with the global one, so only Vale knows what it lints.
async function pluginSkips(filePath: string, root: string | null): Promise<boolean> {
  if (root !== null) return false;
  pluginExtensions ??= Bun.file(VALE_CONFIG).text().then(sectionExtensions);
  const extensions = await pluginExtensions;
  return extensions !== null && !extensions.has(extname(filePath).slice(1));
}

const STYLES = join(import.meta.dirname, "..", "styles");
const SYNC_STAMP = join(STYLES, ".synced");
const SYNC_VERSION = join(STYLES, ".synced-vale");
const SYNC_LOCK = join(STYLES, ".sync.lock");
const LOCK_STALE_MS = 120_000;

async function pinnedPackages(): Promise<string> {
  const ini = await Bun.file(VALE_CONFIG).text();
  // The Packages value, including its backslash-continued lines.
  return /^Packages\s*=\s*((?:.*\\\n)*.*)$/m.exec(ini)?.[1] ?? "";
}

async function isSynced(packages: string): Promise<boolean> {
  const stamp = Bun.file(SYNC_STAMP);
  return (await stamp.exists()) && (await stamp.text()) === packages;
}

// A missing lock reads as infinitely old, which every caller treats as stale.
async function lockAge(): Promise<number> {
  const stat = await Bun.file(SYNC_LOCK)
    .stat()
    .catch(() => null);
  return stat === null ? Infinity : Date.now() - stat.mtimeMs;
}

async function holdLock(): Promise<boolean> {
  try {
    await mkdir(SYNC_LOCK);
    return true;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    if ((await lockAge()) < LOCK_STALE_MS) return false;
    await rm(SYNC_LOCK, { recursive: true, force: true });
    return holdLock();
  }
}

async function awaitSync(packages: string, deadline: number): Promise<boolean> {
  if (await isSynced(packages)) return true;
  if (Date.now() >= deadline) return false;
  // The holder writes the stamp before it releases the lock. A released lock without a stamp means its sync failed.
  if ((await lockAge()) === Infinity) return isSynced(packages);
  await Bun.sleep(250);
  return awaitSync(packages, deadline);
}

async function valeVersion(binary: string): Promise<string> {
  const proc = Bun.spawn([binary, "--version"], { stdout: "pipe", stderr: "ignore" });
  return (await new Response(proc.stdout).text()).trim();
}

// A Vale upgrade can need assets the last sync predates, such as the tree-sitter grammars 3.27 reads code comments with.
async function syncedBy(version: string): Promise<boolean> {
  const stamp = Bun.file(SYNC_VERSION);
  return (await stamp.exists()) && (await stamp.text()) === version;
}

/** Install the plugin's pinned Vale packages into `styles/`, unless this Vale already installed that package list. */
export async function ensurePackages(binary: string): Promise<void> {
  const packages = await pinnedPackages();
  const version = await valeVersion(binary);
  if ((await isSynced(packages)) && (await syncedBy(version))) return;
  if (!(await holdLock())) {
    if (await awaitSync(packages, Date.now() + LOCK_STALE_MS)) return;
    throw new Error("timed out waiting for another process to sync Vale packages");
  }
  try {
    const proc = Bun.spawn([binary, "--no-global", `--config=${VALE_CONFIG}`, "sync"], {
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
    if (exitCode !== 0) throw new Error(`vale sync exited ${exitCode}: ${stderr.trim()}`);
    await Bun.write(SYNC_VERSION, version);
    await Bun.write(SYNC_STAMP, packages);
  } finally {
    await rm(SYNC_LOCK, { recursive: true, force: true });
  }
}

const SYNC_WAIT_MS = 30_000;

async function packagesReady(): Promise<boolean> {
  const packages = await pinnedPackages();
  if (await isSynced(packages)) return true;
  if ((await lockAge()) >= LOCK_STALE_MS) return false;
  return awaitSync(packages, Date.now() + SYNC_WAIT_MS);
}

const INSTALL_HINT = `bun "${join(import.meta.dirname, "..", "hooks", "sessionstart.ts")}"`;

// The plugin's config skips the global one, whose sections would lint files and
// checks the plugin never calibrated. A repo's own config merges with the global
// config as Vale does, except under tests.
function skipsGlobal(root: string | null): boolean {
  return root === null || process.env.NODE_ENV === "test";
}

function configArgs(source: ValeSource, root: string | null): { args: string[]; cwd?: string } {
  const args = root === null ? [`--config=${VALE_CONFIG}`] : [];
  if (skipsGlobal(root)) args.push("--no-global");
  args.push(sourceArg(source, root));
  return root === null ? { args } : { args, cwd: root };
}

async function runVale(
  args: string[],
  { cwd, stdin }: { cwd?: string | undefined; stdin?: string } = {},
): Promise<string | null> {
  const binary = valeBinary();
  if (binary === null) return null;
  // The SessionStart hook installs the packages, so a lint only waits out a sync already running.
  if (cwd === undefined && !(await packagesReady())) {
    throw new Error(`Vale packages are not installed. Run ${INSTALL_HINT}`);
  }
  const proc = Bun.spawn([binary, "--output=JSON", ...args], {
    cwd: cwd ?? process.cwd(),
    stdin: stdin === undefined ? "ignore" : new Blob([stdin]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  // vale exits 1 when it reports an error-level alert, 2 on a runtime failure.
  if (exitCode > 1) throw new ValeError(exitCode, `${stdout.trim()}${stderr.trim()}`);
  return stdout;
}

function alertsOf(stdout: string | null): ValeAlert[] {
  if (stdout === null || stdout.trim() === "") return [];
  return Object.values(Output.parse(JSON.parse(stdout))).flat();
}

function fileArgs(filePath: string, root: string | null): string[] {
  const args = root === null ? [`--config=${VALE_CONFIG}`, filePath] : [relative(root, filePath)];
  if (skipsGlobal(root)) args.unshift("--no-global");
  return args;
}

// An empty file reports no metrics at all.
const Metrics = z.object({ words: z.number().default(0) });

/** Lint `text` with the plugin's Vale config. Returns [] when vale is unavailable, and throws on a runtime failure. */
export async function valeAlerts(text: string, source: ValeSource): Promise<ValeAlert[]> {
  if (text.trim() === "") return [];
  const root = "filePath" in source ? await repoConfigRoot(source.filePath) : null;
  if ("filePath" in source && (await pluginSkips(source.filePath, root))) return [];
  const { args, cwd } = configArgs(source, root);
  return alertsOf(await runVale(args, { cwd, stdin: text }));
}

/** Lint the file at `filePath` as saved, under the repo's Vale config if it has one and the plugin's otherwise. */
export async function lintFile(filePath: string): Promise<ValeAlert[]> {
  const root = await repoConfigRoot(filePath);
  if (await pluginSkips(filePath, root)) return [];
  return alertsOf(await runVale(fileArgs(filePath, root), { cwd: root ?? undefined }));
}

/** Vale's word count for the file at `filePath`, which leaves out code. Null when vale is unavailable. */
export async function valeWords(filePath: string): Promise<number | null> {
  const root = await repoConfigRoot(filePath);
  const args = fileArgs(filePath, root);
  args.splice(-1, 0, "ls-metrics");
  const stdout = await runVale(args, { cwd: root ?? undefined });
  return stdout === null ? null : Metrics.parse(JSON.parse(stdout)).words;
}

/** Alerts in `text`, in position order. No path lints it as a message. */
export async function lintProse(
  text: string,
  filePath?: string,
  { message = false }: { message?: boolean } = {},
): Promise<ValeAlert[]> {
  return valeAlerts(text, message || filePath === undefined ? { kind: "body" } : { filePath });
}
