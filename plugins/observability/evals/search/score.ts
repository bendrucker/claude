#!/usr/bin/env bun
// Scores session search against labeled queries: each arm's search.sql runs in a fresh read-only
// duckdb process on one frozen index, and its ranked sessions are compared with the labels.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Command, InvalidArgumentError } from "@commander-js/extra-typings";
import { table } from "table";
import { z } from "zod";
import { renderSetVariables } from "../../skills/session/scripts/query";
import { type Labeled, mean, median, pairedP, type Scored, score } from "./metrics";

const SKILL = join(import.meta.dirname, "..", "..", "skills", "session");
const INDEX = join(import.meta.dirname, "..", "session", "data", "session.duckdb");

const Label = z.object({
  id: z.string(),
  query: z.string(),
  relevant: z.array(z.object({ host: z.string(), session_id: z.string() })),
  tags: z.array(z.string()).default([]),
});
const Row = z.object({ host: z.string(), session_id: z.string() });

interface Arm {
  name: string;
  skill: string;
}

interface Run extends Scored {
  arm: string;
  id: string;
  walls: number[];
  returned: number;
  error: string | undefined;
}

export async function loadLabels(path: string, tag?: string): Promise<Labeled[]> {
  const lines = (await Bun.file(path).text()).split("\n").filter((l) => l.trim() !== "");
  return lines
    .map((l) => Label.parse(JSON.parse(l)))
    .filter((l) => tag === undefined || l.tags.includes(tag))
    .map((l) => ({
      id: l.id,
      query: l.query,
      tags: l.tags,
      relevant: l.relevant.map((r) => `${r.host}/${r.session_id}`),
    }));
}

async function search(arm: Arm, index: string, query: string, timeoutMs: number) {
  const sql =
    renderSetVariables({ query, limit: 10 }) +
    (await Bun.file(join(arm.skill, "resources", "queries", "search.sql")).text());
  const start = performance.now();
  const proc = Bun.spawn(
    ["duckdb", "-readonly", "-json", "-init", join(arm.skill, "resources", "limits.sql"), index],
    {
      stdin: Buffer.from(sql),
      stdout: "pipe",
      stderr: "pipe",
      signal: AbortSignal.timeout(timeoutMs),
    },
  );
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const wall = (performance.now() - start) / 1000;
  // The CLI can print an error and still exit 0, and renders an empty result as `[{]`.
  const error =
    /\b\w+ Error:.*/.exec(err)?.[0] ?? (proc.exitCode === 0 ? undefined : `exit ${proc.exitCode}`);
  const text = out.trim();
  const rows =
    error !== undefined || text === "" || text === "[{]"
      ? []
      : z.array(Row).parse(JSON.parse(text));
  return { wall, error, ranked: rows.map((r) => `${r.host}/${r.session_id}`) };
}

function parseArm(value: string, previous: Arm[] = []): Arm[] {
  const m = /^([\w.-]+)(?:=(.+))?$/.exec(value);
  if (m?.[1] === undefined) throw new InvalidArgumentError("Expected name[=<skill dir>].");
  return [...previous, { name: m[1], skill: m[2] ?? SKILL }];
}

function count(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new InvalidArgumentError("Not a positive count.");
  return n;
}

const f = (n: number) => n.toFixed(3);

function summarize(runs: Run[], arms: Arm[]) {
  const byArm = Map.groupBy(runs, (r) => r.arm);
  const base = byArm.get(arms[0]?.name ?? "") ?? [];
  return arms.map(({ name }) => {
    const rs = byArm.get(name) ?? [];
    const walls = rs.flatMap((r) => r.walls);
    const p90 = walls.toSorted((a, b) => a - b)[Math.floor(walls.length * 0.9)] ?? 0;
    return {
      arm: name,
      queries: rs.length,
      p5: mean(rs.map((r) => r.p5)),
      recall10: mean(rs.map((r) => r.recall10)),
      mrr: mean(rs.map((r) => r.rr)),
      zeroHit: rs.filter((r) => r.returned === 0).length,
      errors: rs.filter((r) => r.error !== undefined).length,
      wallMedian: median(walls),
      wallP90: p90,
      // Paired over the same queries, against the first arm.
      p5P:
        name === arms[0]?.name
          ? undefined
          : pairedP(
              rs.map((r) => r.p5),
              base.map((r) => r.p5),
            ),
    };
  });
}

const program = new Command()
  .name("score")
  .description("Score session search arms against labeled queries on a frozen index.")
  .requiredOption("--labels <file>", "labels JSONL, as sync.ts pull writes it")
  .option("--index <db>", "frozen index; never the live one", INDEX)
  .option("--arm <name[=skill dir]>", "repeatable; the first is the base", parseArm)
  .option("--tag <tag>", "only queries carrying this tag, such as dev or holdout")
  .option("--runs <n>", "timed runs per query and arm", count, 3)
  .option("--timeout <s>", "seconds per run", count, 120)
  .option("--out <dir>", "write runs.json and summary.json here")
  .action(async (o) => {
    const arms = o.arm ?? [{ name: "main", skill: SKILL }];
    const labels = await loadLabels(o.labels, o.tag);
    const runs: Run[] = [];
    for (const l of labels) {
      for (const a of arms) {
        const walls: number[] = [];
        let last: Awaited<ReturnType<typeof search>> | undefined;
        for (let i = 0; i < o.runs; i++) {
          // oxlint-disable-next-line no-await-in-loop -- runs are timed one at a time so they do not contend.
          last = await search(a, o.index, l.query, o.timeout * 1000);
          walls.push(last.wall);
        }
        const ranked = last?.ranked ?? [];
        runs.push({
          arm: a.name,
          id: l.id,
          walls,
          returned: ranked.length,
          error: last?.error,
          ...score(ranked, l.relevant),
        });
      }
    }
    const summary = summarize(runs, arms);
    if (o.out !== undefined) {
      mkdirSync(o.out, { recursive: true });
      await Bun.write(join(o.out, "runs.json"), JSON.stringify(runs, null, 2));
      await Bun.write(join(o.out, "summary.json"), JSON.stringify(summary, null, 2));
    }
    console.log(
      table([
        [
          "arm",
          "queries",
          "P@5",
          "recall@10",
          "MRR",
          "zero-hit",
          "errors",
          "wall p50 s",
          "wall p90 s",
          "P@5 p",
        ],
        ...summary.map((s) => [
          s.arm,
          s.queries,
          f(s.p5),
          f(s.recall10),
          f(s.mrr),
          s.zeroHit,
          s.errors,
          s.wallMedian.toFixed(2),
          s.wallP90.toFixed(2),
          s.p5P === undefined ? "" : f(s.p5P),
        ]),
      ]),
    );
  });

if (import.meta.main) await program.parseAsync();
