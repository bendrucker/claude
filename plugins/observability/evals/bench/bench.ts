#!/usr/bin/env bun
// Benchmarks the session index on the work agents wait through: the queries they run most and
// the refresh after a transcript changes. README.md covers the workflow.
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command, InvalidArgumentError } from "@commander-js/extra-typings";
import { $ } from "bun";
import { z } from "zod";
import { refresh } from "./refresh";
import {
  type Arm,
  Query,
  render,
  replay,
  replaySet,
  rotate,
  type Sample,
  SKILL,
  summarize,
  writeExport,
} from "./replay";

function arm(value: string, previous: Arm[] = []): Arm[] {
  const m = /^([\w.-]+)=([^,]+)(?:,(.+))?$/.exec(value);
  if (m?.[1] === undefined || m[2] === undefined)
    throw new InvalidArgumentError("Expected name=<db>[,<skill dir>].");
  return [...previous, { name: m[1], db: m[2], skill: m[3] ?? SKILL }];
}

function count(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new InvalidArgumentError("Not a count.");
  return n;
}

// Lines this script wrote itself, so only their shape is checked.
const SampleLine = z.custom<Sample>((v) => typeof v === "object" && v !== null && "wall" in v);

const byQuery = (s: Sample) => `${s.query} ${s.limits}`;

/** Writes the samples, one hyperfine export per group, and the summary, and prints the table. */
async function finish(out: string, name: string, samples: Sample[], key: (s: Sample) => string) {
  const rows = summarize(samples, key);
  await Promise.all([
    Bun.write(join(out, `${name}.jsonl`), samples.map((s) => `${JSON.stringify(s)}\n`).join("")),
    Bun.write(join(out, `${name}.summary.json`), JSON.stringify(rows, null, 2)),
    ...[...Map.groupBy(samples, key)].map(([group, rs]) =>
      writeExport(join(out, "hyperfine", `${group.replace(" ", ".")}.json`), rs),
    ),
  ]);
  console.log(render(rows));
}

const ARM_HELP =
  "name=<index>[,<skill dir>], once per arm; the first is the base. The skill dir defaults to this checkout's";

const program = new Command("bench.ts").description(
  "Benchmark the session index: replay the queries agents run most, and time a refresh per changed transcript.",
);

program
  .command("replay-set")
  .description("Mine the most-run SQL from an index into a replay set.")
  .requiredOption("--db <path>", "index to mine, opened read-only")
  .option("--top <n>", "queries to keep", count, 50)
  .option("--out <path>", "replay set file", join(import.meta.dirname, "replay.json"))
  .action(async (o) => {
    const set = await replaySet(o.db, o.top);
    await Bun.write(o.out, `${JSON.stringify(set, null, 2)}\n`);
    console.log(
      `${o.out}: ${set.length} queries, ${set.filter((q) => q.ooms > 0).length} with OOMs`,
    );
  });

program
  .command("run")
  .description("Replay the set against every arm at each limit, rotating arm order each round.")
  .requiredOption("--arm <arm>", ARM_HELP, arm)
  .requiredOption("--out <dir>", "results directory")
  .option("--replay <path>", "replay set", join(import.meta.dirname, "replay.json"))
  .option("--limits <list>", "mac, vm, or both", "mac,vm")
  .option("--runs <n>", "recorded runs per query, arm, and limit", count, 10)
  .option("--warmup <n>", "unrecorded runs per query, arm, and limit", count, 1)
  .option("--prepare <cmd>", "shell command before every run, such as a cache drop")
  .option("--only <regex>", "replay only the queries whose id matches")
  .option("--timeout <s>", "seconds before a query is killed", count, 300)
  .action(async (o) => {
    const set = z.array(Query).parse(await Bun.file(o.replay).json());
    const queries = set.filter((q) => o.only === undefined || new RegExp(o.only).test(q.id));
    const limits = z.array(z.enum(["mac", "vm"])).parse(o.limits.split(","));
    const tmp = mkdtempSync(join(tmpdir(), "session-bench-"));
    const schedule = Array.from({ length: o.warmup + o.runs }, (_, r) =>
      queries.flatMap((q, i) =>
        limits.flatMap((lim) =>
          rotate(o.arm, r + i).map((a) => ({ run: r - o.warmup, q, lim, a })),
        ),
      ),
    ).flat();
    const perRun = schedule.length / (o.warmup + o.runs);
    const samples: Sample[] = [];
    for (const [i, { run, q, lim, a }] of schedule.entries()) {
      // oxlint-disable-next-line no-await-in-loop -- runs are timed one at a time.
      if (o.prepare !== undefined) await $`sh -c ${o.prepare}`.quiet();
      // oxlint-disable-next-line no-await-in-loop -- runs are timed one at a time.
      const r = await replay(q, a, lim, tmp, o.timeout * 1000);
      if (run >= 0)
        samples.push({ query: q.id, limits: lim, arm: a.name, base: a === o.arm[0], run, ...r });
      if ((i + 1) % perRun === 0) console.error(`run ${run + 1}/${o.runs}`);
    }
    await $`rm -rf ${tmp}`;
    mkdirSync(o.out, { recursive: true });
    await finish(o.out, "queries", samples, byQuery);
  });

program
  .command("refresh")
  .description(
    "Time an incremental refresh after transcripts of each size change, against clones of each arm's index.",
  )
  .requiredOption("--arm <arm>", ARM_HELP, arm)
  .requiredOption("--out <dir>", "results directory")
  .option(
    "--rows <list>",
    "transcript sizes in rows, the corpus median and p90 by default",
    "50,373",
  )
  .option("--files <n>", "transcripts changed per refresh", count, 1)
  .option("--runs <n>", "refreshes per size and arm", count, 10)
  .action(async (o) => {
    mkdirSync(o.out, { recursive: true });
    // Beside the results, on the volume that holds the clones, so APFS can clone instead of copy.
    const dir = mkdtempSync(join(o.out, ".work-"));
    const samples: Sample[] = [];
    for (const rows of o.rows.split(",").map(Number)) {
      // oxlint-disable-next-line no-await-in-loop -- sizes run one at a time, each a full benchmark.
      samples.push(...(await refresh({ arms: o.arm, rows, files: o.files, runs: o.runs, dir })));
    }
    await $`rm -rf ${dir}`;
    await finish(o.out, "refresh", samples, (s) => s.query);
  });

program
  .command("report")
  .description("Reprint the tables of a results directory.")
  .argument("<dir>", "results directory")
  .action(async (dir) => {
    for (const name of ["queries", "refresh"]) {
      const file = Bun.file(join(dir, `${name}.jsonl`));
      // oxlint-disable-next-line no-await-in-loop -- two files, printed in order.
      if (!(await file.exists())) continue;
      // oxlint-disable-next-line no-await-in-loop -- two files, printed in order.
      const lines = (await file.text()).trim().split("\n");
      const samples = lines.map((l) => SampleLine.parse(JSON.parse(l)));
      console.log(render(summarize(samples, name === "queries" ? byQuery : (s) => s.query)));
    }
  });

if (import.meta.main) {
  await program.parseAsync();
}
