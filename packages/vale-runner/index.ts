import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

export const Alert = z.object({
  Check: z.string(),
  Message: z.string(),
  Severity: z.enum(["error", "warning", "suggestion"]),
  Line: z.number(),
  Span: z.tuple([z.number(), z.number()]),
  Match: z.string(),
});
export type Alert = z.infer<typeof Alert>;

const Output = z.record(z.string(), z.array(Alert));

export class ValeError extends Error {
  readonly exitCode: number;
  constructor(exitCode: number, output: string) {
    super(`vale exited ${exitCode}: ${output}`);
    this.name = "ValeError";
    this.exitCode = exitCode;
  }
}

export function valeBinary(): string | null {
  return Bun.which("vale");
}

/** Vale's stdout for `args`. Throws when the binary is missing or Vale reports a runtime failure. */
export async function vale(args: readonly string[]): Promise<string> {
  const binary = valeBinary();
  if (binary === null)
    throw new Error("vale is not on PATH. Install it: https://vale.sh/docs/install");
  const proc = Bun.spawn([binary, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  // vale exits 1 when it reports an error-level alert, 2 on a runtime failure.
  if (exitCode > 1) throw new ValeError(exitCode, `${stdout.trim()}${stderr.trim()}`);
  return stdout;
}

export interface LintOptions {
  config: string;
  /** Vale's `--glob`, which filters the files it reads under each path. */
  glob?: string;
  /** Paths per Vale run, since one run over thousands of files fails. */
  batch?: number;
  /** Called for a file Vale fails on alone. Without it, that failure throws. */
  onSkip?: (path: string, error: unknown) => void;
}

async function lintOnce(
  paths: readonly string[],
  { config, glob }: LintOptions,
): Promise<Map<string, Alert[]>> {
  // The global config would merge its styles into the caller's.
  const args = ["--no-global", `--config=${config}`, "--output=JSON"];
  if (glob !== undefined) args.push(`--glob=${glob}`);
  const stdout = await vale([...args, ...paths]);
  if (stdout.trim() === "") return new Map();
  return new Map(Object.entries(Output.parse(JSON.parse(stdout))));
}

const probes = new Map<string, Promise<void>>();

/** Rejects when the config or binary is broken, so a failed batch is not blamed on its files. */
function probe(config: string): Promise<void> {
  let probed = probes.get(config);
  if (probed === undefined) {
    probed = (async () => {
      const dir = await mkdtemp(join(tmpdir(), "vale-probe-"));
      try {
        await Bun.write(join(dir, "probe.md"), "Probe.\n");
        await lintOnce([join(dir, "probe.md")], { config });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    })();
    probes.set(config, probed);
  }
  return probed;
}

async function lintSplitting(
  paths: readonly string[],
  options: LintOptions,
): Promise<Map<string, Alert[]>> {
  try {
    return await lintOnce(paths, options);
  } catch (error) {
    await probe(options.config);
    const [path] = paths;
    if (paths.length === 1 && path !== undefined) {
      if (options.onSkip === undefined) throw error;
      options.onSkip(path, error);
      return new Map();
    }
    const at = Math.ceil(paths.length / 2);
    return new Map([
      ...(await lintSplitting(paths.slice(0, at), options)),
      ...(await lintSplitting(paths.slice(at), options)),
    ]);
  }
}

/**
 * Alerts for each file under `paths`, keyed by Vale's cleaned path and
 * ordered by position. A file without alerts is absent.
 */
export async function lint(
  paths: readonly string[],
  options: LintOptions,
): Promise<Map<string, Alert[]>> {
  if (paths.length === 0) return new Map();
  const size = options.batch ?? 400;
  const alerts = await lintSplitting(paths.slice(0, size), options);
  for (const [path, found] of await lint(paths.slice(size), options)) alerts.set(path, found);
  return alerts;
}
