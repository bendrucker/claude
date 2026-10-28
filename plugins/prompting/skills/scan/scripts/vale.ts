import { join, resolve } from "node:path";
import { z } from "zod";

export const VALE_CONFIG = join(import.meta.dirname, "..", "..", "..", ".vale.ini");

const Alert = z.object({
  Check: z.string(),
  Message: z.string(),
  Line: z.number(),
  Span: z.tuple([z.number(), z.number()]),
  Match: z.string(),
});
const Output = z.record(z.string(), z.array(Alert));

export type Alert = z.infer<typeof Alert>;

/**
 * Alerts for each file, keyed by the path as given and sorted by position.
 * A file without alerts is absent.
 */
export async function lint(
  files: readonly string[],
  config: string = VALE_CONFIG,
): Promise<Map<string, Alert[]>> {
  const alerts = new Map<string, Alert[]>();
  if (files.length === 0) return alerts;
  const binary = Bun.which("vale");
  if (binary === null)
    throw new Error("vale is not on PATH. Install it: https://vale.sh/docs/install");
  // The global config would merge its styles into the plugin's.
  const proc = Bun.spawn([binary, "--no-global", `--config=${config}`, "--output=JSON", ...files], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  // vale exits 1 when it reports an error-level alert, 2 on a runtime failure.
  if (exitCode > 1) throw new Error(`vale exited ${exitCode}: ${stdout.trim()}${stderr.trim()}`);
  if (stdout.trim() === "") return alerts;
  // Vale keys its output by a normalized path, so map each back to the path the caller gave.
  const given = new Map(files.map((file) => [resolve(file), file]));
  for (const [path, found] of Object.entries(Output.parse(JSON.parse(stdout)))) {
    alerts.set(
      given.get(resolve(path)) ?? path,
      found.toSorted((a, b) => (a.Line === b.Line ? a.Span[0] - b.Span[0] : a.Line - b.Line)),
    );
  }
  return alerts;
}
