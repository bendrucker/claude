import { join } from "node:path";
import { z } from "zod";

export const VALE_CONFIG = join(import.meta.dirname, "..", "..", "..", ".vale.ini");

const Alert = z.object({
  Check: z.string(),
  Message: z.string(),
  Severity: z.enum(["error", "warning", "suggestion"]),
  Line: z.number(),
  Span: z.tuple([z.number(), z.number()]),
  Match: z.string(),
});
const Output = z.record(z.string(), z.array(Alert));

export type Alert = z.infer<typeof Alert>;

export interface LintOptions {
  config?: string;
  /** Vale's `--glob`, which filters the files it reads under each path. */
  glob?: string;
}

/**
 * Alerts for each file under `paths`, keyed by Vale's cleaned path and
 * ordered by position. A file without alerts is absent.
 */
export async function lint(
  paths: readonly string[],
  { config = VALE_CONFIG, glob }: LintOptions = {},
): Promise<Map<string, Alert[]>> {
  if (paths.length === 0) return new Map();
  const binary = Bun.which("vale");
  if (binary === null)
    throw new Error("vale is not on PATH. Install it: https://vale.sh/docs/install");
  // The global config would merge its styles into the plugin's.
  const args = ["--no-global", `--config=${config}`, "--output=JSON"];
  if (glob !== undefined) args.push(`--glob=${glob}`);
  const proc = Bun.spawn([binary, ...args, ...paths], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  // vale exits 1 when it reports an error-level alert, 2 on a runtime failure.
  if (exitCode > 1) throw new Error(`vale exited ${exitCode}: ${stdout.trim()}${stderr.trim()}`);
  if (stdout.trim() === "") return new Map();
  return new Map(Object.entries(Output.parse(JSON.parse(stdout))));
}
