import { mkdir, rm } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { z } from "zod";
import { isProseFile } from "./paths";

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

export function valeBinary(): string | null {
  const onPath = Bun.which("vale");
  if (onPath !== null) return onPath;
  const data = process.env.CLAUDE_PLUGIN_DATA;
  if (data === undefined || data === "") return null;
  const bundled = join(data, "bin", "vale");
  return Bun.which(bundled) ?? null;
}

function extensionOf(source: ValeSource): string {
  if ("kind" in source) return source.kind === "commit" ? ".commitmsg" : ".prbody";
  const ext = extname(source.filePath);
  return ext === "" ? ".prbody" : ext;
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

async function holdLock(): Promise<boolean> {
  try {
    await mkdir(SYNC_LOCK);
    return true;
  } catch {
    const age =
      Date.now() -
      (
        await Bun.file(SYNC_LOCK)
          .stat()
          .catch(() => ({ mtimeMs: 0 }))
      ).mtimeMs;
    if (age < LOCK_STALE_MS) return false;
    await rm(SYNC_LOCK, { recursive: true, force: true });
    return holdLock();
  }
}

async function awaitSync(packages: string, deadline: number): Promise<boolean> {
  if (await isSynced(packages)) return true;
  if (Date.now() >= deadline) return false;
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

const INSTALL_HINT = `bun "${join(import.meta.dirname, "..", "hooks", "sessionstart.ts")}"`;

// A repo's own config replaces the plugin's, since Vale merges only the global
// config with one other. Tests skip the global config so they see only the plugin's styles.
async function configArgs(source: ValeSource): Promise<{ args: string[]; cwd?: string }> {
  const root = "filePath" in source ? await repoConfigRoot(source.filePath) : null;
  const args = root === null ? [`--config=${VALE_CONFIG}`] : [];
  if (process.env.NODE_ENV === "test") args.push("--no-global");
  return root === null ? { args } : { args, cwd: root };
}

/** Lint `text` with the plugin's Vale config. Returns [] when vale is unavailable, or on a runtime failure unless `strict`. */
export async function valeAlerts(
  text: string,
  source: ValeSource,
  { strict = false }: { strict?: boolean } = {},
): Promise<ValeAlert[]> {
  if (text.trim() === "") return [];
  const binary = valeBinary();
  if (binary === null) return [];
  const { args, ...cwd } = await configArgs(source);
  // The SessionStart hook installs the packages, so a lint only checks for them.
  if (cwd.cwd === undefined && !(await isSynced(await pinnedPackages()))) {
    throw new Error(`Vale packages are not installed. Run ${INSTALL_HINT}`);
  }
  const proc = Bun.spawn([binary, ...args, "--output=JSON", `--ext=${extensionOf(source)}`], {
    ...cwd,
    stdin: new Blob([text]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  // vale exits 1 when it reports an error-level alert, 2 on a runtime failure.
  if (exitCode > 1 && strict) throw new Error(`vale exited ${exitCode}: ${stderr.trim()}`);
  if (exitCode > 1 || stdout.trim() === "") return [];
  return Object.values(Output.parse(JSON.parse(stdout))).flat();
}

/** Alerts in prose at warning or above, sorted by position. A code file yields none, and no path lints as a message. */
export async function lintProse(
  text: string,
  filePath?: string,
  { message = false }: { message?: boolean } = {},
): Promise<ValeAlert[]> {
  if (filePath !== undefined && !isProseFile(filePath)) return [];
  const source = message || filePath === undefined ? { kind: "body" as const } : { filePath };
  return (await valeAlerts(text, source))
    .filter((alert) => alert.Severity !== "suggestion")
    .toSorted((a, b) => (a.Line === b.Line ? a.Span[0] - b.Span[0] : a.Line - b.Line));
}
