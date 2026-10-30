import { mkdir, rm } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { z } from "zod";

export const VALE_CONFIG = join(import.meta.dirname, "..", ".vale.ini");

/** Where text came from, which picks the `.vale.ini` section that lints it. */
export type ValeSource = { filePath: string } | { kind: "body" | "commit" };

const Alert = z.object({
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

// A file goes by its path relative to the config root, which is what a
// directory-scoped section such as `[docs/*.md]` matches against.
function sourceArg(source: ValeSource, root: string | null): string {
  if ("kind" in source) return `--ext=${source.kind === "commit" ? ".commitmsg" : ".prbody"}`;
  const path = root === null ? basename(source.filePath) : relative(root, source.filePath);
  return `--path=${path}`;
}

/** The directory of the nearest `.vale.ini` or `_vale.ini` above `filePath`, if a repo adopted Vale. */
export async function repoConfigRoot(filePath: string): Promise<string | null> {
  const ancestors: string[] = [];
  for (let dir = dirname(filePath); ; dir = dirname(dir)) {
    ancestors.push(dir);
    if (dirname(dir) === dir) break;
  }
  const adopted = await Promise.all(
    ancestors.map(async (dir) =>
      (
        await Promise.all(
          [".vale.ini", "_vale.ini"].map((name) => Bun.file(join(dir, name)).exists()),
        )
      ).some(Boolean),
    ),
  );
  return ancestors[adopted.indexOf(true)] ?? null;
}

const STYLES = join(import.meta.dirname, "..", "styles");
const SYNC_STAMP = join(STYLES, ".synced");
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

/** Install the plugin's pinned Vale packages into `styles/`, unless that package list is already installed. */
export async function ensurePackages(binary: string): Promise<void> {
  const packages = await pinnedPackages();
  if (await isSynced(packages)) return;
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

// A repo's own config replaces the plugin's, since Vale merges only the global
// config with one other. Tests skip the global config so they see only the plugin's styles.
async function configArgs(source: ValeSource): Promise<{ args: string[]; cwd?: string }> {
  const root = "filePath" in source ? await repoConfigRoot(source.filePath) : null;
  const args = root === null ? [`--config=${VALE_CONFIG}`] : [];
  if (process.env.NODE_ENV === "test") args.push("--no-global");
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
  if (process.env.NODE_ENV === "test") args.unshift("--no-global");
  return args;
}

// An empty file reports no metrics at all.
const Metrics = z.object({ words: z.number().default(0) });

/** Lint `text` with the plugin's Vale config. Returns [] when vale is unavailable, and throws on a runtime failure. */
export async function valeAlerts(text: string, source: ValeSource): Promise<ValeAlert[]> {
  if (text.trim() === "") return [];
  const { args, cwd } = await configArgs(source);
  return alertsOf(await runVale(args, { cwd, stdin: text }));
}

/** Lint the file at `filePath` as saved, under the repo's Vale config if it has one and the plugin's otherwise. */
export async function lintFile(filePath: string): Promise<ValeAlert[]> {
  const root = await repoConfigRoot(filePath);
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

/** Alerts for every file under `dir`, linted with `config` alone. */
export async function lintDirectory(dir: string, config: string): Promise<ValeAlert[]> {
  return alertsOf(await runVale(["--no-global", `--config=${config}`, dir]));
}

/** Alerts in `text`, in position order. No path lints it as a message. */
export async function lintProse(
  text: string,
  filePath?: string,
  { message = false }: { message?: boolean } = {},
): Promise<ValeAlert[]> {
  return valeAlerts(text, message || filePath === undefined ? { kind: "body" } : { filePath });
}
