#!/usr/bin/env bun
// Benchmarks the session index on the work agents wait through: the queries they run most and
// the refresh after a transcript changes.
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command, InvalidArgumentError } from "@commander-js/extra-typings";
import { $ } from "bun";
import { z } from "zod";
import { refresh } from "./refresh";
import { snapshot } from "./snapshot";
import {
  type Arm,
  checkViews,
  Query,
  render,
  replay,
  replaySet,
  rotate,
  type Sample,
  SKILL,
  summarize,
  timed,
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

const KEYS = {
  queries: (s: Sample) => `${s.query} ${s.limits}`,
  refresh: (s: Sample) => s.query,
};

async function finish(out: string, name: keyof typeof KEYS, samples: Sample[]) {
  const key = KEYS[name];
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
  .command("snapshot")
  .description(
    "Write a month-stratified sample of an index's transcripts back out as JSONL to build arms from.",
  )
  .requiredOption("--db <path>", "index to sample, opened read-only")
  .requiredOption("--out <dir>", "snapshot directory; transcripts land under projects/")
  .option("--mb <n>", "JSONL to keep, in MB", count, 1200)
  .action(async (o) => {
    console.log(`${await snapshot(o.db, o.out, o.mb * 2 ** 20)} transcripts in ${o.out}`);
  });

program
  .command("build")
  .description("Build an arm's index from a snapshot with the arm's own refresh.ts, timing it.")
  .requiredOption("--snapshot <dir>", "directory from the snapshot command")
  .requiredOption("--out <dir>", "index directory to create")
  .option("--skill <dir>", "the arm's session skill checkout", SKILL)
  .action(async (o) => {
    if (await Bun.file(join(o.out, "session.duckdb")).exists())
      throw new Error(`${o.out} already holds an index`);
    const home = mkdtempSync(join(tmpdir(), "session-bench-home-"));
    // A throwaway HOME keeps the refresh off this machine's debug logs and imported hosts.
    const { wall, exit, rss } = await timed(
      ["bun", join(o.skill, "scripts", "refresh.ts"), "--refresh"],
      {
        env: {
          ...process.env,
          HOME: home,
          CLAUDE_SESSION_INDEX_DIR: o.out,
          CLAUDE_PROJECTS_DIR: join(o.snapshot, "projects"),
          CLAUDE_SESSION_IMPORTS_DIR: join(home, "imports"),
        },
      },
    );
    const build = {
      wall,
      exit,
      rss,
      size: Bun.file(join(o.out, "session.duckdb")).size,
    };
    await $`rm -rf ${home}`;
    await Bun.write(join(o.out, "build.json"), JSON.stringify(build, null, 2));
    console.log(JSON.stringify(build));
    if (exit !== 0) process.exit(exit);
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
    await Promise.all(o.arm.map(checkViews));
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
    await finish(o.out, "queries", samples);
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
    "transcript sizes in rows, the corpus median and p90 by default; 0 changes one transcript of the largest session",
    "50,373",
  )
  .option("--files <n>", "transcripts changed per refresh", count, 1)
  .option("--runs <n>", "refreshes per size and arm", count, 10)
  .action(async (o) => {
    await Promise.all(o.arm.map(checkViews));
    mkdirSync(o.out, { recursive: true });
    // Beside the results, on the volume that holds the clones, so APFS can clone instead of copy.
    const dir = mkdtempSync(join(o.out, ".work-"));
    const samples: Sample[] = [];
    for (const rows of o.rows.split(",").map(Number)) {
      // oxlint-disable-next-line no-await-in-loop -- sizes run one at a time, each a full benchmark.
      samples.push(...(await refresh({ arms: o.arm, rows, files: o.files, runs: o.runs, dir })));
    }
    await $`rm -rf ${dir}`;
    await finish(o.out, "refresh", samples);
  });

program
  .command("report")
  .description("Reprint the tables of a results directory.")
  .argument("<dir>", "results directory")
  .action(async (dir) => {
    for (const name of ["queries", "refresh"] as const) {
      const file = Bun.file(join(dir, `${name}.jsonl`));
      // oxlint-disable-next-line no-await-in-loop -- two files, printed in order.
      if (!(await file.exists())) continue;
      // oxlint-disable-next-line no-await-in-loop -- two files, printed in order.
      const lines = (await file.text()).trim().split("\n");
      const samples = lines.map((l) => SampleLine.parse(JSON.parse(l)));
      console.log(render(summarize(samples, KEYS[name])));
    }
  });

if (import.meta.main) {
  await program.parseAsync();
}
