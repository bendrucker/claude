#!/usr/bin/env bun
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { cli } from "cleye";
import { table } from "table";
import { decodeJson } from "../../../../../packages/decode/index";
import { type CaseResult, CaseResult as CaseResultSchema, median } from "./metrics";

const ROOT = join(import.meta.dirname, "..");
const WC_LOOP_MIN = 3;

async function subdirectories(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
}

export async function loadRun(dir: string): Promise<Map<string, CaseResult[]>> {
  const byArm = new Map<string, CaseResult[]>();
  const arms = await subdirectories(dir);
  await Promise.all(
    arms.map(async (arm) => {
      const armDir = join(dir, arm);
      const files = (await readdir(armDir)).filter((name) => name.endsWith(".json"));
      const results = await Promise.all(
        files.map(async (name) =>
          decodeJson(CaseResultSchema, await Bun.file(join(armDir, name)).text(), name),
        ),
      );
      byArm.set(
        arm,
        results.toSorted((a, b) => a.id.localeCompare(b.id)),
      );
    }),
  );
  return byArm;
}

const pct = (n: number, d: number): string => (d === 0 ? "-" : `${Math.round((100 * n) / d)}%`);

export function summaryRows(byArm: Map<string, CaseResult[]>): string[][] {
  const rows: string[][] = [
    [
      "arm",
      "n",
      "tokens p50",
      "tokens max",
      "wc loops",
      "edits p50",
      "chars p50",
      "over 10k",
      "near 10k",
      "sidecar",
      "deleted p50",
    ],
  ];
  for (const [arm, results] of byArm) {
    const tokens = results.map((r) => r.transcript.output_tokens);
    const landed = results.filter((r) => r.chars_after !== null);
    rows.push([
      arm,
      String(results.length),
      String(Math.round(median(tokens))),
      String(Math.max(0, ...tokens)),
      String(results.filter((r) => r.transcript.wc_calls >= WC_LOOP_MIN).length),
      String(median(results.map((r) => r.transcript.edits))),
      String(Math.round(median(landed.map((r) => r.chars_after ?? 0)))),
      pct(results.filter((r) => r.over_limit).length, results.length),
      pct(results.filter((r) => r.near_limit).length, results.length),
      pct(results.filter((r) => r.sidecars.length > 0).length, results.length),
      pct(
        median(results.map((r) => (r.lines.before === 0 ? 0 : r.lines.deleted / r.lines.before))),
        1,
      ),
    ]);
  }
  return rows;
}

export function caseRows(byArm: Map<string, CaseResult[]>): string[][] {
  const arms = [...byArm.keys()];
  const header = ["case", "before"];
  for (const arm of arms) header.push(`${arm} tokens`, `${arm} wc`, `${arm} after`, `${arm} del`);
  const ids = new Set(arms.flatMap((arm) => (byArm.get(arm) ?? []).map((r) => r.id)));
  const rows = [header];
  for (const id of [...ids].toSorted()) {
    const row = [id];
    let before = "";
    for (const arm of arms) {
      const result = (byArm.get(arm) ?? []).find((r) => r.id === id);
      if (result === undefined) {
        row.push("", "", "", "");
        continue;
      }
      before = String(result.chars_before);
      row.push(
        String(result.transcript.output_tokens),
        String(result.transcript.wc_calls),
        String(result.chars_after ?? "missing"),
        `${result.lines.deleted}/${result.lines.before}`,
      );
    }
    row.splice(1, 0, before);
    rows.push(row);
  }
  return rows;
}

// results/ also holds logs and the saved replay baselines, so a run is the
// latest directory that has an arm directory inside it.
async function latestRun(resultsDir: string): Promise<string> {
  const candidates = await subdirectories(resultsDir);
  const withArms = await Promise.all(
    candidates.map(async (run) =>
      (await subdirectories(join(resultsDir, run))).length > 0 ? run : null,
    ),
  );
  const latest = withArms.findLast((run) => run !== null);
  if (latest === undefined) throw new Error(`no runs under ${resultsDir}`);
  return latest;
}

if (import.meta.main) {
  const argv = cli({
    name: "report",
    help: { description: "Summarize a rework run per arm and per case." },
    flags: {
      run: { type: String, description: "Run label under results/ (default: latest)" },
      cases: { type: Boolean, description: "Also print the per-case table" },
    },
  });
  const resultsDir = join(ROOT, "results");
  const run = argv.flags.run ?? (await latestRun(resultsDir));
  const byArm = await loadRun(join(resultsDir, run));
  console.log(`run ${run}`);
  console.log(table(summaryRows(byArm)));
  if (argv.flags.cases) console.log(table(caseRows(byArm)));
}
