import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";

export const WORKFLOW = join(import.meta.dirname, "..", "..", "..", "workflow", "fix.workflow.js");

export const Level = z.enum(["suggestion", "warning", "error"]);
export type Level = z.infer<typeof Level>;
const RANK = { suggestion: 0, warning: 1, error: 2 } as const satisfies Record<Level, number>;

export const Alert = z.object({
  Check: z.string(),
  Message: z.string(),
  Line: z.number(),
  Span: z.tuple([z.number(), z.number()]),
  Match: z.string(),
  Severity: Level,
  Action: z
    .object({ Name: z.string(), Params: z.array(z.string()).nullable() })
    .partial()
    .optional(),
});
export type Alert = z.infer<typeof Alert>;

const Output = z.record(z.string(), z.array(Alert));

export type Lint = (config: string, paths: readonly string[]) => Promise<Map<string, Alert[]>>;

export const lint: Lint = async (config, paths) => {
  const binary = Bun.which("vale");
  if (binary === null)
    throw new Error("vale is not on PATH. Install it: https://vale.sh/docs/install");
  const proc = Bun.spawn([binary, "--no-global", `--config=${config}`, "--output=JSON", ...paths], {
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
  return new Map(
    Object.entries(Output.parse(JSON.parse(stdout === "" ? "{}" : stdout))).map(
      ([file, alerts]) => [resolve(file), alerts],
    ),
  );
};

export function atLeast(alerts: readonly Alert[], level: Level): Alert[] {
  return alerts.filter((alert) => RANK[alert.Severity] >= RANK[level]);
}

const key = (alert: Alert): string => `${alert.Check}|${alert.Match}`;

/** Alerts in `after` beyond what `before` already had, matched by check and text so a moved line still matches. */
export function introduced(before: readonly Alert[], after: readonly Alert[]): Alert[] {
  const remaining = new Map<string, number>();
  for (const alert of before) remaining.set(key(alert), (remaining.get(key(alert)) ?? 0) + 1);
  return after.filter((alert) => {
    const left = remaining.get(key(alert)) ?? 0;
    if (left === 0) return true;
    remaining.set(key(alert), left - 1);
    return false;
  });
}

const ShardEntry = z.object({
  id: z.number(),
  file: z.string(),
  shard: z.string(),
  original: z.string(),
  baseline: z.string(),
});

export const Job = z.object({
  config: z.string(),
  level: Level,
  model: z.string(),
  shards: z.array(ShardEntry),
});
export type Job = z.infer<typeof Job>;

export interface PreflightOptions {
  config: string;
  paths: readonly string[];
  level: Level;
  model: string;
  jobRoot?: string;
  lint?: Lint;
}

export interface Preflight {
  jobDir: string;
  argsPath: string;
  scriptPath: string;
  files: number;
  alerts: number;
}

export async function preflight({
  config,
  paths,
  level,
  model,
  jobRoot = join(tmpdir(), "vale-fix"),
  lint: run = lint,
}: PreflightOptions): Promise<Preflight> {
  const absolute = resolve(config);
  const results = await run(
    absolute,
    paths.map((path) => resolve(path)),
  );
  await mkdir(jobRoot, { recursive: true });
  const jobDir = await mkdtemp(join(jobRoot, "job-"));
  const targets = [...results]
    .map(([file, alerts]) => ({ file, alerts, fixable: atLeast(alerts, level) }))
    .filter((target) => target.fixable.length > 0)
    .toSorted((a, b) => a.file.localeCompare(b.file));
  const shards = await Promise.all(
    targets.map(async ({ file, alerts, fixable }, id) => {
      const entry = {
        id,
        file,
        shard: join(jobDir, `shard-${id}.json`),
        original: join(jobDir, `original-${id}`),
        baseline: join(jobDir, `baseline-${id}.json`),
      };
      await Promise.all([
        Bun.write(entry.original, Bun.file(file)),
        Bun.write(entry.baseline, JSON.stringify(alerts)),
        Bun.write(
          entry.shard,
          JSON.stringify(
            {
              file,
              config: absolute,
              alerts: fixable.map((alert) => ({
                line: alert.Line,
                span: alert.Span,
                check: alert.Check,
                severity: alert.Severity,
                message: alert.Message,
                match: alert.Match,
                action: alert.Action,
              })),
            },
            null,
            2,
          ),
        ),
      ]);
      return entry;
    }),
  );
  const job: Job = { config: absolute, level, model, shards };
  const argsPath = join(jobDir, "job.json");
  await Bun.write(argsPath, JSON.stringify(job, null, 2));
  return {
    jobDir,
    argsPath,
    scriptPath: WORKFLOW,
    files: shards.length,
    alerts: targets.reduce((sum, target) => sum + target.fixable.length, 0),
  };
}

export type Status = "fixed" | "partial" | "untouched" | "restored";

export interface Outcome {
  file: string;
  before: number;
  after: number;
  status: Status;
  /** Alerts a rewrite added, which is why it was restored. */
  added: string[];
}

export async function apply(jobDir: string, run: Lint = lint): Promise<Outcome[]> {
  const job = Job.parse(await Bun.file(join(jobDir, "job.json")).json());
  const results = await run(
    job.config,
    job.shards.map((shard) => shard.file),
  );
  return Promise.all(
    job.shards.map(async (shard): Promise<Outcome> => {
      const baseline = z.array(Alert).parse(await Bun.file(shard.baseline).json());
      const original = await Bun.file(shard.original).text();
      const after = results.get(shard.file) ?? [];
      const before = atLeast(baseline, job.level).length;
      const added = introduced(baseline, after);
      if ((await Bun.file(shard.file).text()) === original) {
        return { file: shard.file, before, after: before, status: "untouched", added: [] };
      }
      if (added.length > 0) {
        await Bun.write(shard.file, original);
        return {
          file: shard.file,
          before,
          after: before,
          status: "restored",
          added: added.map((alert) => `${alert.Line}:${alert.Check} '${alert.Match}'`),
        };
      }
      const remaining = atLeast(after, job.level).length;
      return {
        file: shard.file,
        before,
        after: remaining,
        status: remaining === 0 ? "fixed" : "partial",
        added: [],
      };
    }),
  );
}
