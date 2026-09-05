import { join, resolve } from "node:path";
import { z } from "zod";

/** The shape `promptfoo export eval <id> -o <file>` writes. Only the fields read here. */
export const ExportPayload = z.looseObject({
  evalId: z.string(),
  results: z
    .looseObject({
      timestamp: z.string().optional(),
      prompts: z
        .array(
          z.looseObject({
            metrics: z.looseObject({ cost: z.number().optional() }).optional(),
          }),
        )
        .optional(),
    })
    .optional(),
  config: z.looseObject({ description: z.string().optional() }).optional(),
  metadata: z.looseObject({ evaluationCreatedAt: z.string().optional() }).optional(),
});
export type ExportPayload = z.infer<typeof ExportPayload>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function repoRoot(): string {
  return join(import.meta.dirname, "..", "..");
}

export function resultsDir(override?: string): string {
  return resolve(override ?? join(repoRoot(), "evals", "results"));
}

function utcDate(stamp: string): string | undefined {
  const parsed = new Date(stamp);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString().slice(0, 10);
}

// The date names the run, so it comes from the run itself. A caller with a payload
// that carries no timestamp injects one rather than falling back to the clock,
// which would file a re-export of an old run under today.
export function runDate(payload: ExportPayload, override?: string): string {
  if (override !== undefined) {
    if (!ISO_DATE.test(override)) throw new Error(`--date takes YYYY-MM-DD, got "${override}"`);
    return override;
  }
  const stamp = payload.results?.timestamp ?? payload.metadata?.evaluationCreatedAt;
  const date = stamp === undefined ? undefined : utcDate(stamp);
  if (date === undefined) {
    throw new Error(`${payload.evalId} carries no run timestamp: pass --date YYYY-MM-DD`);
  }
  return date;
}

export function slug(value: string): string {
  return value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
}

export function suiteName(payload: ExportPayload, override?: string): string {
  const source = override ?? payload.config?.description ?? "";
  const name = slug(source);
  if (name === "") {
    throw new Error(`${payload.evalId} has no suite: pass --suite, or set the config description`);
  }
  return name;
}

// promptfoo ids embed an ISO timestamp, whose colons are hostile to filenames and
// to the S3 sync that mirrors them.
export function safeId(evalId: string): string {
  const id = evalId.replaceAll(/[^A-Za-z0-9._-]+/g, "-").replaceAll(/^-+|-+$/g, "");
  if (id === "") throw new Error(`Eval id "${evalId}" has no characters usable in a filename`);
  return id;
}

export function exportFilename(payload: ExportPayload, date: string): string {
  return `${date}-${safeId(payload.evalId)}.json`;
}

export function destination(
  dir: string,
  payload: ExportPayload,
  options: { suite?: string | undefined; date?: string | undefined } = {},
): string {
  const date = runDate(payload, options.date);
  return join(dir, suiteName(payload, options.suite), exportFilename(payload, date));
}

export function runCost(payload: ExportPayload): number {
  const prompts = payload.results?.prompts ?? [];
  return prompts.reduce((total, prompt) => total + (prompt.metrics?.cost ?? 0), 0);
}
