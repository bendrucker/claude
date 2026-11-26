#!/usr/bin/env bun

import { join } from "node:path";
import { table } from "table";
import { type Result, readResult } from "../../../../packages/evals/result";

const KINDS = ["error", "warning", "tp", "fp", "task"] as const;
type Kind = (typeof KINDS)[number];

/** The finding kind a grader scores, from its `<scenario>-<kind>[-<detail>]` name. */
export function kindOf(grader: string): Kind | undefined {
  const kind = grader.split("-")[1];
  return KINDS.find((k) => k === kind);
}

/** The arm a case runs, from its `<scenario>-<arm>` name. */
export function armOf(name: string): string {
  return name.split("-").at(-1) ?? name;
}

interface Cell {
  passed: number;
  total: number;
}

/** Every scored grader outcome, as its arm, finding kind, and pass. */
function outcomes(results: Result[]): { arm: string; kind: Kind; passed: boolean }[] {
  return results.flatMap((result) =>
    result.cases.flatMap((c) =>
      (c.arms.with ?? [])
        .filter((run) => run.error == null)
        .flatMap((run) =>
          run.graders.flatMap((grader) => {
            const kind = kindOf(grader.name);
            return kind === undefined ? [] : [{ arm: armOf(c.name), kind, passed: grader.passed }];
          }),
        ),
    ),
  );
}

/** Pass counts per arm and finding kind, pooled over every scenario and run. */
export function tally(results: Result[]): Map<string, Map<Kind, Cell>> {
  const out = new Map<string, Map<Kind, Cell>>();
  for (const { arm, kind, passed } of outcomes(results)) {
    const kinds = out.get(arm) ?? new Map<Kind, Cell>();
    out.set(arm, kinds);
    const cell = kinds.get(kind) ?? { passed: 0, total: 0 };
    cell.total += 1;
    if (passed) cell.passed += 1;
    kinds.set(kind, cell);
  }
  return out;
}

const HEADERS: Record<Kind, string> = {
  error: "error fixed",
  warning: "warning fixed",
  tp: "TP suggestion applied",
  fp: "FP suggestion left",
  task: "task done",
};

function row(arm: string, kinds: Map<Kind, Cell>): string[] {
  const cells = KINDS.map((kind) => {
    const cell = kinds.get(kind);
    return cell === undefined ? "-" : `${cell.passed}/${cell.total}`;
  });
  return [arm, ...cells];
}

async function main(dirs: string[]): Promise<void> {
  if (dirs.length === 0) throw new Error("usage: report.ts <results dir>...");
  const results = await Promise.all(
    dirs.map(async (dir) => readResult(join(dir, "aggregate-result.json"))),
  );
  const rows = [...tally(results)].map(([arm, kinds]) => row(arm, kinds));
  process.stdout.write(table([["arm", ...KINDS.map((k) => HEADERS[k])], ...rows]));
}

if (import.meta.main) await main(process.argv.slice(2));
