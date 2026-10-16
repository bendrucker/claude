#!/usr/bin/env bun
import { globSync } from "node:fs";
import { basename, join } from "node:path";
import { Command } from "@commander-js/extra-typings";
import { mean } from "simple-statistics";
import { table } from "table";
import { z } from "zod";
import { pValue } from "../../../../../evals/native/compare";
import { traceReply } from "../../../../../evals/native/load";
import { FrameTruth, notesFromTrace, scoreFrame } from "./frame";
import { scoreReply, Truth } from "./ranking";

export const CaseTruth = z.union([FrameTruth, Truth]);
export type CaseTruth = z.output<typeof CaseTruth>;

export interface ScoredRun {
  case: string;
  arm: string;
  run: number;
  composite: number;
  /** Per-metric scores in [0, 1], except `traps`, which counts. */
  metrics: Record<string, number>;
}

/** The metric each case kind reports a p-value on beside the composite. */
const KEY_METRIC = { ranking: "cited", frame: "assumed" } as const;

export function scoreTrace(
  trace: string,
  truth: CaseTruth,
  profile: string,
): Pick<ScoredRun, "composite" | "metrics"> {
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
    const truth = CaseTruth.parse(await Bun.file(join(suite, name, "truth.json")).json());
    const profile =
      truth.kind === "ranking" ? await Bun.file(join(suite, name, truth.profile)).text() : "";
    const trace = await Bun.file(join(results, file)).text();
    return [
      {
        case: name,
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

function row(head: string[], values: number[]): string[] {
  const cells = [...head];
  for (const v of values) cells.push(fixed(v));
  return cells;
}

export function render(runs: ScoredRun[], kinds: Record<string, CaseTruth["kind"]>): string {
  const out: string[] = [];
  const names = [...new Set(runs.map((r) => r.case))].toSorted();
  for (const name of names) {
    const ofCase = runs.filter((r) => r.case === name);
    const metrics = Object.keys(ofCase[0]?.metrics ?? {});
    const arms = [...new Set(ofCase.map((r) => r.arm))].toSorted();
    const of = (arm: string) => ofCase.filter((r) => r.arm === arm);
    const columns = [...metrics, "composite"];
    const perRun = ofCase.map((r) =>
      row(
        [name, r.arm, String(r.run)],
        columns.map((m) => pick(r, m)),
      ),
    );
    const perArm = arms.map((arm) =>
      row(
        [name, arm, String(of(arm).length)],
        columns.map((m) => mean(of(arm).map((r) => pick(r, m)))),
      ),
    );
    out.push(
      table([["case", "arm", "run", ...columns], ...perRun]),
      table([["case", "arm", "runs", ...columns], ...perArm]),
    );
    const key = KEY_METRIC[kinds[name] ?? "ranking"];
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
    const kinds = Object.fromEntries(
      await Promise.all(
        [...new Set(flat.map((r) => r.case))].map(async (name) => {
          const truth = CaseTruth.parse(await Bun.file(join(suite, name, "truth.json")).json());
          return [name, truth.kind] as const;
        }),
      ),
    );
    console.log(json === true ? JSON.stringify(flat, null, 2) : render(flat, kinds));
  });

if (import.meta.main) await program.parseAsync();
