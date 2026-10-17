#!/usr/bin/env bun
import { globSync } from "node:fs";
import { basename, join } from "node:path";
import { Command } from "@commander-js/extra-typings";
import { mean } from "simple-statistics";
import { table } from "table";
import { z } from "zod";
import { pValue } from "../../../../../packages/evals/stats";
import { traceReply } from "../../../../../packages/evals/trace";
import { DecideTruth, scoreDecide } from "./decide";
import { FrameTruth, notesFromTrace, scoreFrame } from "./frame";
import { OffCpuTruth, scoreOffCpu } from "./offcpu";
import { scoreReply, Truth } from "./ranking";

export const CaseTruth = z.union([FrameTruth, DecideTruth, OffCpuTruth, Truth]);
export type CaseTruth = z.output<typeof CaseTruth>;
type Kind = CaseTruth["kind"];

export interface ScoredRun {
  case: string;
  /** The case kind. */
  family: Kind;
  /** What the per-arm tables pool over: the case, or a decide case's trap. */
  group: string;
  arm: string;
  run: number;
  composite: number;
  /** Per-metric scores in [0, 1], except `traps`, a count, and `lead-rank`, a rank. */
  metrics: Record<string, number>;
}

/** The metric each kind reports a p-value on beside the composite. */
const KEY_METRIC: Record<Kind, string> = {
  ranking: "cited",
  frame: "assumed",
  decide: "decision",
  offcpu: "lead@1",
};

type Scored = Pick<ScoredRun, "composite" | "metrics">;

export function scoreTrace(trace: string, truth: CaseTruth, profile: string): Scored {
  const reply = traceReply(trace) ?? "";
  if (truth.kind === "frame") {
    const s = scoreFrame(reply, notesFromTrace(trace, truth.notes), truth);
    const checks = Object.fromEntries(Object.entries(s.checks).map(([k, v]) => [k, Number(v)]));
    return {
      composite: s.composite,
      metrics: {
        notes: Number(s.notes),
        ...checks,
        assumed: s.assumed,
        checkpoint: Number(s.checkpoint),
      },
    };
  }
  if (truth.kind === "decide") {
    const s = scoreDecide(reply, truth);
    return {
      composite: s.composite,
      metrics: { decision: Number(s.correct), reason: Number(s.reason) },
    };
  }
  if (truth.kind === "offcpu") {
    const s = scoreOffCpu(reply, truth);
    const checks = Object.fromEntries(Object.entries(s.checks).map(([k, v]) => [k, Number(v)]));
    return {
      composite: s.composite,
      metrics: {
        ...checks,
        traps: s.traps.length,
        "lead@1": Number(s.leadRank === 1),
        "lead-rank": s.leadRank,
      },
    };
  }
  const s = scoreReply(reply, truth, profile);
  return {
    composite: s.composite,
    metrics: {
      recall: s.recall,
      traps: s.traps.length,
      cited: s.cited,
      parallel: Number(s.parallelism),
    },
  };
}

const TRACE = /^(.+)-([^-]+)-(\d+)\.jsonl$/;

/**
 * Scores every trace under `<results>/traces/` against its case's truth. With a `label`, every
 * arm but the no-plugin baseline takes that name, so runs at different refs stay apart.
 */
export async function scoreResults(
  suite: string,
  results: string,
  label?: string,
): Promise<ScoredRun[]> {
  const files = globSync("traces/*.jsonl", { cwd: results }).toSorted();
  const runs = files.map(async (file) => {
    const m = TRACE.exec(basename(file));
    if (m === null) return [];
    const [, name = "", arm = "", n = "0"] = m;
    const truthFile = Bun.file(join(suite, name, "truth.json"));
    if (!(await truthFile.exists())) return [];
    const truth = CaseTruth.parse(await truthFile.json());
    const profile =
      truth.kind === "ranking" ? await Bun.file(join(suite, name, truth.profile)).text() : "";
    const trace = await Bun.file(join(results, file)).text();
    return [
      {
        case: name,
        family: truth.kind,
        group: truth.kind === "decide" ? truth.trap : name,
        arm: label !== undefined && arm !== "without" ? label : arm,
        run: Number(n),
        ...scoreTrace(trace, truth, profile),
      },
    ];
  });
  return (await Promise.all(runs)).flat();
}

const fixed = (x: number) => x.toFixed(2);
const pick = (r: ScoredRun, m: string) => (m === "composite" ? r.composite : (r.metrics[m] ?? 0));
const unique = (xs: string[]) => [...new Set(xs)].toSorted();

function row(head: string[], values: number[]): string[] {
  const cells = [...head];
  for (const v of values) cells.push(fixed(v));
  return cells;
}

/** A per-arm table and permutation p-values between every pair of arms over `runs`. */
function summary(name: string, runs: ScoredRun[], key: string): string[] {
  const columns = [...Object.keys(runs[0]?.metrics ?? {}), "composite"];
  const arms = unique(runs.map((r) => r.arm));
  const of = (arm: string) => runs.filter((r) => r.arm === arm);
  const perArm = arms.map((arm) =>
    row(
      [name, arm, String(of(arm).length)],
      columns.map((m) => mean(of(arm).map((r) => pick(r, m)))),
    ),
  );
  const out = [table([["case", "arm", "runs", ...columns], ...perArm])];
  for (const [i, base] of arms.entries()) {
    for (const other of arms.slice(i + 1)) {
      const p = (m: string) =>
        pValue(
          of(base).map((r) => pick(r, m)),
          of(other).map((r) => pick(r, m)),
        ).toFixed(3);
      out.push(
        `${name} ${other} vs ${base}: permutation p = ${p("composite")} composite, ${p(key)} ${key}`,
      );
    }
  }
  return out;
}

/**
 * Per-arm tables for each case (each trap, for decide cases), with per-run rows for the
 * hand-built cases, then a pooled table for each family that spans several.
 */
export function render(runs: ScoredRun[]): string {
  const out: string[] = [];
  const families = Object.entries(KEY_METRIC).toSorted(([a], [b]) => a.localeCompare(b));
  for (const [family, key] of families) {
    const ofFamily = runs.filter((r) => r.family === family);
    if (ofFamily.length === 0) continue;
    const groups = unique(ofFamily.map((r) => r.group));
    for (const group of groups) {
      const ofGroup = ofFamily.filter((r) => r.group === group);
      if (family !== "decide") {
        const columns = [...Object.keys(ofGroup[0]?.metrics ?? {}), "composite"];
        const perRun = ofGroup.map((r) =>
          row(
            [group, r.arm, String(r.run)],
            columns.map((m) => pick(r, m)),
          ),
        );
        out.push(table([["case", "arm", "run", ...columns], ...perRun]));
      }
      out.push(...summary(group, ofGroup, key));
    }
    if (groups.length > 1) out.push(...summary(`${family} (all)`, ofFamily, key));
  }
  return out.join("\n");
}

export const program = new Command("score.ts")
  .description("Score claude plugin eval results against each case's truth.json")
  .argument(
    "<results...>",
    "results directories holding traces/, each optionally as <label>=<dir> to name its plugin arm",
  )
  .option("--json", "Print the scored runs as JSON")
  .action(async (results, { json }) => {
    const suite = join(import.meta.dir, "..");
    const runs = await Promise.all(
      results.map((r) => {
        const at = r.indexOf("=");
        return at === -1
          ? scoreResults(suite, r)
          : scoreResults(suite, r.slice(at + 1), r.slice(0, at));
      }),
    );
    const flat = runs.flat();
    console.log(json === true ? JSON.stringify(flat, null, 2) : render(flat));
  });

if (import.meta.main) await program.parseAsync();
