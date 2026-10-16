#!/usr/bin/env bun
import { globSync } from "node:fs";
import { join } from "node:path";
import { Command } from "@commander-js/extra-typings";
import { $ } from "bun";
import type { Decision, DecideTruth } from "./decide";

interface Lead {
  name: string;
  entry: string;
  cum: number;
  hypothesis: string;
  micro: string;
}

interface Domain {
  id: string;
  target: string;
  metric: string;
  command: string;
  seconds: number;
  ncpu: number;
  peakMb: number;
  guard: string;
  guardPass: string;
  guardFail: string;
  profiler: string;
  profile: [entry: string, flat: number, cum: number][];
  big: Lead;
  small: Lead;
}

export const DOMAINS: Domain[] = [
  {
    id: "cli",
    target: "ripcfg --version",
    metric:
      "wall time of `ripcfg --version` from a cold process on the 10-core dev laptop, which every shell prompt hook runs",
    command: "./bin/{arm}/ripcfg --version",
    seconds: 0.1824,
    ncpu: 10,
    peakMb: 38.4,
    guard:
      "stdout byte-identical to `testdata/version.golden` and exit code 0. Check: `ripcfg --version | cmp - testdata/version.golden`",
    guardPass: "passed (stdout byte-identical, exit 0)",
    guardFail:
      "failed. `cmp` reports stdout differs at byte 19: the candidate prints `schema v?` where the golden has `schema v7`",
    profiler: "`go tool pprof -top -cum` of a CPU profile over 200 starts",
    profile: [
      ["main.main", 0.4, 96.1],
      ["ripcfg/config.Read", 2.1, 61.3],
      ["ripcfg/config.(*Schema).compile", 18.2, 34.7],
      ["ripcfg/plugin.discover", 1.3, 19.8],
      ["regexp.Compile", 9.6, 12.4],
      ["runtime.mallocgc", 7.7, 7.7],
      ["ripcfg/telemetry.init", 0.6, 5.9],
    ],
    big: {
      name: "generate the compiled schema",
      entry: "ripcfg/config.(*Schema).compile",
      cum: 34.7,
      hypothesis:
        "`(*Schema).compile` rebuilds the same validator on every start (34.7% cum). Generating it at `go generate` time removes most of that",
      micro: "bench/micro schema",
    },
    small: {
      name: "defer telemetry setup",
      entry: "ripcfg/telemetry.init",
      cum: 5.9,
      hypothesis:
        "`telemetry.init` opens its spool file at start (5.9% cum). Opening it on the first event removes that from `--version`",
      micro: "bench/micro telemetry",
    },
  },
  {
    id: "tests",
    target: "billing test suite",
    metric:
      "wall time of `pytest -q tests/` on the 8-core CI runner, which every PR waits on before review",
    command: "uv run --project worktrees/{arm} pytest -q tests/",
    seconds: 94.2,
    ncpu: 8,
    peakMb: 612.0,
    guard:
      "the same test IDs pass, fail, and skip as on base, and exit code 0. Check: `bench/junit-diff.sh base candidate`",
    guardPass: "passed (junit outcomes identical, exit 0)",
    guardFail:
      "failed. `bench/junit-diff.sh` reports `tests/refunds/test_rounding.py::test_partial_refund` passes on base and fails on the candidate",
    profiler: "`py-spy record --format raw` over one full run, summarized by cumulative share",
    profile: [
      ["_pytest.main:pytest_runtestloop", 1.2, 97.8],
      ["tests/conftest.py:db", 3.1, 46.2],
      ["sqlalchemy.sql.schema:MetaData.create_all", 22.4, 31.0],
      ["tests/factories.py:InvoiceFactory", 6.2, 14.8],
      ["billing/pdf.py:render", 9.9, 11.3],
      ["freezegun.api:freeze_time", 4.1, 6.1],
    ],
    big: {
      name: "clone a template database per test",
      entry: "tests/conftest.py:db",
      cum: 46.2,
      hypothesis:
        "the `db` fixture runs `create_all` and the migrations for every test (46.2% cum). Migrating one template database per session and cloning it per test removes most of that",
      micro: "bench/micro db-fixture",
    },
    small: {
      name: "swap freezegun for time-machine",
      entry: "freezegun.api:freeze_time",
      cum: 6.1,
      hypothesis:
        "`freeze_time` patches every imported module on entry (6.1% cum). `time-machine` patches the clock in C instead",
      micro: "bench/micro freeze",
    },
  },
  {
    id: "build",
    target: "atlas release build",
    metric:
      "wall time of `cargo build --release` from an empty `target/` on the 16-core release runner, which a release waits on",
    command: "bench/cold-build.sh {arm}",
    seconds: 212.6,
    ncpu: 16,
    peakMb: 9120.0,
    guard:
      "`cargo test --release` passes the same tests as base and `atlas selftest` prints the same report. Check: `bench/guard.sh`",
    guardPass: "passed (test outcomes and selftest report identical)",
    guardFail:
      "failed. `bench/guard.sh` reports `atlas selftest` differs on `q17`: the candidate picks a hash join where base picks a merge join",
    profiler: "`cargo build --release --timings`, units by share of the critical path",
    profile: [
      ["atlas-query (lib) codegen", 28.4, 28.4],
      ["serde_derive expansion, all crates", 17.9, 17.9],
      ["atlas-proto build.rs (protoc)", 11.2, 11.2],
      ["link atlas (bin)", 9.8, 9.8],
      ["aws-sdk-s3 (lib)", 6.1, 6.1],
      ["openssl-sys build.rs", 4.9, 4.9],
    ],
    big: {
      name: "raise codegen units for atlas-query",
      entry: "atlas-query (lib) codegen",
      cum: 28.4,
      hypothesis:
        "`atlas-query` codegen runs on one thread for 28.4% of the critical path. `codegen-units = 16` for that crate spreads it across the runner's cores",
      micro: "bench/micro atlas-query",
    },
    small: {
      name: "drop openssl-sys for rustls",
      entry: "openssl-sys build.rs",
      cum: 4.9,
      hypothesis:
        "`openssl-sys`'s build script probes the system OpenSSL (4.9% of the critical path). Building `reqwest` with `rustls-tls` removes the crate",
      micro: "bench/micro tls",
    },
  },
  {
    id: "latency",
    target: "searchd replay",
    metric:
      "wall time of `bench/replay.sh`, which sends 2,000 recorded `/search` requests 8 at a time to a local `searchd` on the 8-core staging box. It stands in for the p50 a user waits on",
    command: "bench/replay.sh {arm}",
    seconds: 7.42,
    ncpu: 8,
    peakMb: 288.0,
    guard:
      "every response body byte-identical to `testdata/replay.golden` and the same status codes. Check: `bench/guard.sh`",
    guardPass: "passed (2,000 of 2,000 responses identical)",
    guardFail:
      "failed. `bench/guard.sh` reports 37 of 2,000 responses differ: results with tied scores come back in a different order",
    profiler: "`go tool pprof -top -cum` of a CPU profile over one replay",
    profile: [
      ["net/http.(*conn).serve", 1.2, 92.4],
      ["searchd/rank.Score", 21.7, 38.9],
      ["encoding/json.Marshal", 8.8, 17.3],
      ["searchd/index.(*Postings).Intersect", 11.4, 14.2],
      ["compress/gzip.(*Writer).Write", 9.1, 11.0],
      ["searchd/log.Access", 1.0, 5.2],
    ],
    big: {
      name: "precompute term weights",
      entry: "searchd/rank.Score",
      cum: 38.9,
      hypothesis:
        "`rank.Score` recomputes each term's IDF per document (38.9% cum). Computing it once when the index opens removes most of that",
      micro: "bench/micro score",
    },
    small: {
      name: "buffer the access log",
      entry: "searchd/log.Access",
      cum: 5.2,
      hypothesis:
        "`log.Access` writes one unbuffered line per request (5.2% cum). A buffered writer flushed each second removes the per-request syscall",
      micro: "bench/micro accesslog",
    },
  },
];

interface Measured {
  change: number;
  p: number;
  failures?: number;
}

interface Trap {
  id: string;
  decisions: Decision[];
  note: string;
  reason: string[][];
  lead: "big" | "small";
  full: (v: number, lead: Lead) => Measured;
  screen?: (v: number) => Measured;
  floor?: (v: number) => number;
  /** The 1-based rounds that ran loaded. */
  loaded?: number[];
  guardFails?: boolean;
}

const at = <T>(xs: [T, ...T[]], i: number): T => xs[i % xs.length] ?? xs[0];

const SIGNIFICANT = [
  String.raw`\bp\b(\s*[=<≈]|\s+(is|of))\s*0?\.\d`,
  "signific",
  "beat (the )?noise",
];

const LOAD = [
  "load average",
  String.raw`\bloaded\b`,
  "machine load",
  String.raw`\bload\b[^\n]{0,60}(flag|round|above|high|2×|2x|cpu|core)`,
  String.raw`(flag|round)[^\n]{0,60}\bload\b`,
  "busy",
  "noisy machine",
];

const BOUND = [
  [
    "exceed",
    "larger than",
    "more than",
    "bigger than",
    "greater than",
    "beyond",
    "bound",
    "unexplained",
    "(can't|cannot|doesn't|does not) (be )?(explain|account)",
    "impossible",
    "implausibl",
    "only accounts",
    "at most",
    "can't come from",
    "cannot come from",
  ],
  ["profile", "share", "cum", "critical path"],
];

export const TRAPS: Trap[] = [
  {
    id: "noise-floor",
    decisions: ["reject"],
    note: "The gain is starred at the report's 3% default, but it is smaller than the A/A noise floor the Rules make the acceptance threshold.",
    reason: [["noise", "A/A", "floor"]],
    lead: "big",
    full: (v) => ({ change: -at([3.6, 3.4, 4.1], v), p: at([0.041, 0.067, 0.022], v) }),
    floor: (v) => at([5.2, 4.8, 6.1], v),
  },
  {
    id: "load",
    decisions: ["re-run"],
    note: "The gain is significant, but every round ran with the load average above twice the core count.",
    reason: [LOAD],
    lead: "big",
    full: (v) => ({ change: -at([11.8, 9.4, 13.6], v), p: at([0.002, 0.004, 0.001], v) }),
    loaded: [1, 2, 3, 4, 5, 6],
  },
  {
    id: "profile-bound",
    decisions: ["re-run"],
    note: "The gain is larger than the target entry's whole share of the profile, so it cannot come from that entry alone.",
    reason: BOUND,
    lead: "small",
    full: (v) => ({ change: -at([17.9, 21.4, 15.6], v), p: at([0.001, 0.001, 0.002], v) }),
    screen: (v) => ({ change: -at([44.2, 51.0, 39.3], v), p: 0.001 }),
  },
  {
    id: "failed-runs",
    decisions: ["reject", "re-run"],
    note: "The candidate arm has failed runs, which the report drops from its median, so the arm falls short of the Rules' run count. Rejecting, or re-running once the failures are explained, both hold the gain back.",
    reason: [["fail", "exit", "error", "crash", "non-?zero"]],
    lead: "big",
    full: (v) => ({
      change: -at([12.6, 10.9, 14.2], v),
      p: at([0.003, 0.006, 0.002], v),
      failures: at([4, 3, 5], v),
    }),
  },
  {
    id: "fast-signal",
    decisions: ["reject"],
    note: "The fast-signal screen moved, but the full metric is flat. The Rules accept on the full metric only.",
    reason: [
      ["full", "wall", "end.to.end", "metric"],
      [
        "flat",
        "not significant",
        "insignificant",
        "(didn't|did not|doesn't|does not) (move|improve|change)",
        "no (real |significant |measurable )?(change|gain|improvement|effect)",
        "unchanged",
        String.raw`p\s*=\s*0?\.[1-9]`,
        "within (the )?noise",
        String.raw`\bnull\b`,
        "barely",
        String.raw`(screen|micro\w*)[^\n]{0,60}(n't|not|only)`,
      ],
    ],
    lead: "big",
    full: (v) => ({ change: at([-0.7, 0.4, -1.1], v), p: at([0.62, 0.81, 0.47], v) }),
    screen: (v) => ({ change: -at([38.2, 41.5, 33.9], v), p: 0.001 }),
  },
  {
    id: "guard",
    decisions: ["reject"],
    note: "The gain is real, but the guard check failed before timing.",
    reason: [
      [
        "guard",
        String.raw`cmp\b`,
        "differ",
        "golden",
        "byte-identical",
        "not identical",
        "behaviou?r (change|differ)",
        "changes? (the )?(output|behaviou?r|results?)",
      ],
    ],
    lead: "big",
    full: (v) => ({ change: -at([10.8, 12.3, 9.7], v), p: at([0.002, 0.001, 0.003], v) }),
    guardFails: true,
  },
  {
    id: "win",
    decisions: ["accept"],
    note: "Control: a significant gain past the noise floor, inside the profile bound, on quiet rounds, with the guard passing.",
    reason: [SIGNIFICANT],
    lead: "big",
    full: (v) => ({ change: -at([10.4, 12.9, 8.6], v), p: at([0.001, 0.002, 0.003], v) }),
  },
  {
    id: "null",
    decisions: ["reject"],
    note: "Control: neither the screen nor the full metric moved past noise.",
    reason: [
      [
        "not significant",
        "insignificant",
        String.raw`p\s*=\s*0?\.[1-9]`,
        "no (real |significant |measurable )?(change|gain|improvement|effect)",
        "within (the )?noise",
        "flat",
        "(didn't|did not|doesn't|does not) (move|improve)",
        "below",
      ],
    ],
    lead: "big",
    full: (v) => ({ change: at([-0.9, 0.6, -1.4], v), p: at([0.55, 0.74, 0.41], v) }),
    screen: (v) => ({ change: -at([2.1, 1.4, 3.0], v), p: at([0.31, 0.52, 0.22], v) }),
  },
  {
    id: "compound",
    decisions: ["re-run"],
    note: "Two of six rounds ran loaded, and the gain clears the noise floor by only a tenth, so the accept may rest on the loaded rounds.",
    reason: [LOAD, ["noise", "A/A", "floor", "margin", "barely", "just (above|over|past)"]],
    lead: "big",
    full: (v) => ({ change: -at([4.0, 4.4, 3.6], v), p: at([0.044, 0.028, 0.061], v) }),
    floor: (v) => at([3.6, 4.0, 3.3], v),
    loaded: [2, 5],
  },
  {
    id: "near-floor",
    decisions: ["accept"],
    note: "Control: the gain is only 1.1 times the noise floor, but it clears it, at p < 0.1, on quiet rounds, with the guard passing.",
    reason: [SIGNIFICANT, ["noise", "A/A", "floor"]],
    lead: "big",
    full: (v) => ({ change: -at([3.7, 4.2, 4.6], v), p: at([0.031, 0.054, 0.018], v) }),
    floor: (v) => at([3.4, 3.8, 4.2], v),
  },
  {
    id: "near-bound",
    decisions: ["accept", "re-run"],
    note: "The gain is 1.05 times the target entry's whole profile share. The excess is inside the noise floor, so accepting with the excess reported or re-measuring both hold, as long as the reply notices the bound.",
    reason: BOUND,
    lead: "small",
    full: (v, lead) => ({
      change: -Number((lead.cum * 1.05).toFixed(1)),
      p: at([0.004, 0.002, 0.006], v),
    }),
    screen: (v) => ({ change: -at([38.1, 44.6, 35.2], v), p: 0.001 }),
  },
  {
    id: "partial-load",
    decisions: ["accept"],
    note: "Control: one of six rounds ran loaded, and a gain this size at p = 0.001 cannot rest on three runs a side, so the flag doesn't block the accept.",
    reason: [LOAD],
    lead: "big",
    full: (v) => ({ change: -at([14.6, 12.2, 15.8], v), p: 0.001 }),
    loaded: [4],
  },
];

const RUNS = 18;
const ALPHA = 0.1;
const MIN_EFFECT = 3;

function seconds(s: number): string {
  return s >= 1 ? `${s.toFixed(2)}s` : `${(s * 1000).toFixed(1)}ms`;
}

interface Arm {
  name: string;
  n: number;
  median: number;
  spread: number;
  memory: number;
  failures: number;
}

/** A `compare.ts report --markdown` table for a base and a candidate arm. */
export function report(base: Arm, cand: Arm, p: number): string {
  const change = (cand.median / base.median - 1) * 100;
  const lowN = cand.n < 4 || base.n < 4;
  const significant = !lowN && p < ALPHA && Math.abs(change) >= MIN_EFFECT;
  const row = (a: Arm, cells: [string, string]) =>
    `| ${a.name} | ${a.n}${lowN ? "†" : ""} | ${seconds(a.median)} | ${a.spread.toFixed(1)}% | ${cells[0]} | ${cells[1]} | ${a.memory.toFixed(1)} | ${a.failures === 0 ? "" : a.failures} |`;
  return [
    "| arm | n | median | ±MAD | change | p | peak MB | failed |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    row(base, ["base", ""]),
    row(cand, [
      `${change >= 0 ? "+" : ""}${change.toFixed(1)}%${significant ? "*" : ""}`,
      p.toFixed(3),
    ]),
    "",
    `* p < ${ALPHA} and |change| ≥ ${MIN_EFFECT}%. † fewer than 4 runs a side, too few to star.`,
  ].join("\n");
}

interface Round {
  order: string[];
  loadBefore: number;
  loadAfter: number;
}

export function rounds(ncpu: number, loaded: number[], k: number): Round[] {
  return Array.from({ length: 6 }, (_, i) => {
    const busyRound = loaded.includes(i + 1);
    const quiet = 1.1 + ((k * 7 + i * 3) % 30) / 10;
    const busy = 2 * ncpu + 3 + ((k * 5 + i * 4) % 12);
    const load = busyRound ? busy : quiet;
    return {
      order: i % 2 === 0 ? ["base", "candidate"] : ["candidate", "base"],
      loadBefore: Number(load.toFixed(2)),
      loadAfter: Number((load + (busyRound ? 1.5 : 0.4)).toFixed(2)),
    };
  });
}

export function loadLine(ncpu: number, rs: Round[]): string {
  const flagged = rs.flatMap((r, i) =>
    Math.max(r.loadBefore, r.loadAfter) > 2 * ncpu ? [i + 1] : [],
  );
  if (flagged.length === 0) return `load: no round above 2×${ncpu} cpus`;
  return `load: ${flagged.length} of ${rs.length} rounds above 2×${ncpu} cpus (${flagged.join(", ")}). Re-run an accept that rests on them`;
}

export interface Generated {
  name: string;
  prompt: string;
  truth: DecideTruth;
}

export function generate(trap: Trap, domain: Domain, v: number, k: number): Generated {
  const lead = domain[trap.lead];
  const floor = trap.floor?.(v) ?? at([1.4, 1.8, 2.2, 1.6, 2.5, 1.2], k);
  const full = trap.full(v, lead);
  const screen = trap.screen?.(v) ?? {
    change: Math.max(-62, full.change / (lead.cum / 100)),
    p: 0.001,
  };
  const failures = full.failures ?? 0;
  const base = domain.seconds * (1 + (v - 1) * 0.012);
  const arm = (name: string, median: number, n: number, failed: number, i: number): Arm => ({
    name,
    n,
    median,
    spread: at([1.6, 2.1, 1.9, 1.4, 2.4], i),
    memory: domain.peakMb * (1 + (name === "base" ? 0 : 0.004 * (v + 1))),
    failures: failed,
  });
  const microBase = (domain.seconds * lead.cum) / 100 / at([1, 1.1, 0.95], v);
  const screenTable = report(
    arm("base", microBase, RUNS, 0, k),
    arm("candidate", microBase * (1 + screen.change / 100), RUNS, 0, k + 1),
    screen.p,
  );
  const fullTable = report(
    arm("base", base, RUNS, 0, k + 2),
    arm("candidate", base * (1 + full.change / 100), RUNS - failures, failures, k + 3),
    full.p,
  );
  const n = 2 + ((k * 3) % 5);
  const hypothesis = `${lead.hypothesis}.`;
  const rs = rounds(domain.ncpu, trap.loaded ?? [], k);
  const command = (a: string) => domain.command.replace("{arm}", a);
  const meta = {
    hypothesis: lead.hypothesis,
    started: `2026-10-${String(10 + (k % 5)).padStart(2, "0")}T1${k % 10}:04:12.000Z`,
    ncpu: domain.ncpu,
    arms: [
      { name: "base", command: command("base") },
      { name: "candidate", command: command("candidate") },
    ],
    rounds: rs,
  };
  const profile = domain.profile
    .map(([entry, flat, cum]) => `| ${flat.toFixed(1)}% | ${cum.toFixed(1)}% | \`${entry}\` |`)
    .join("\n");
  const notes = [
    `# \`${domain.target}\` Performance Climb`,
    "",
    "## Rules",
    "",
    `- Metric: ${domain.metric}.`,
    `- Fast signal: \`${lead.micro}\`, a microbenchmark of the changed path. Screen with it only. Accept on the metric.`,
    `- Guard: ${domain.guard}.`,
    "- Acceptance: interleaved A/B against the current accepted arm, 6 rounds of 3 runs a side, permutation p < 0.1, a median gain at least the A/A noise floor under Baseline, and the guard passing.",
    "",
    "## Baseline",
    "",
    `A/A noise floor: ${floor.toFixed(1)}% median difference between two unchanged arms, p = ${at(["0.44", "0.61", "0.38", "0.72"], k)}.`,
    "",
    "## Profile",
    "",
    `${domain.profiler}, top entries:`,
    "",
    "| flat | cum | entry |",
    "| ---: | ---: | --- |",
    profile,
    "",
    "## Candidates",
    "",
    `### Candidate ${n}: ${lead.name}`,
    "",
    `Hypothesis: ${hypothesis}`,
    "",
    "Target: the metric falls.",
    "",
    `Guards: ${domain.guard.split(". Check:")[0]}.`,
    "",
    `Guard check: ${trap.guardFails === true ? domain.guardFail : domain.guardPass}.`,
  ].join("\n");
  const dir = `tmp/bench/c${n}`;
  const prompt = [
    `/performance:hill-climb "${domain.target}" CLIMB.md`,
    "",
    `Candidate ${n} finished measuring. Decide it from what's below and tell me why.`,
    "",
    "## `CLIMB.md`, excerpt",
    "",
    "````markdown",
    notes,
    "````",
    "",
    `## Screen: \`compare.ts report ${dir}-screen --markdown\``,
    "",
    "```",
    `hypothesis: ${lead.hypothesis}`,
    "",
    screenTable,
    "```",
    "",
    `## Full metric: \`compare.ts report ${dir} --markdown\``,
    "",
    "```",
    `hypothesis: ${lead.hypothesis}`,
    loadLine(domain.ncpu, rs),
    "",
    fullTable,
    "```",
    "",
    `## \`${dir}/meta.json\``,
    "",
    "```json",
    JSON.stringify(meta, null, 2),
    "```",
    "",
  ].join("\n");
  return {
    name: `decide-${trap.id}-${domain.id}`,
    prompt,
    truth: {
      kind: "decide",
      trap: trap.id,
      decisions: trap.decisions,
      note: trap.note,
      reason: trap.reason,
    },
  };
}

/** Every trap on three of the four domains, skipping a different domain per trap. */
export function all(): Generated[] {
  return TRAPS.flatMap((trap, t) =>
    DOMAINS.filter((_, d) => d !== t % DOMAINS.length).map((domain, v) =>
      generate(trap, domain, v, t * 3 + v),
    ),
  );
}

const CASE = `schema_version: "1.1"
name: {name}
tags: [decide]
plugins: ["../../.."]
execution:
  model: claude-sonnet-5-5
  max_turns: 4
  timeout_seconds: 300
  allowed_tools: [Skill]
  append_system_prompt: >-
    Nothing can be built or run in this session, and nobody answers while you
    work, so reply once. End the reply with one line naming your decision on
    the candidate: \`Decision: accept\`, \`Decision: reject\`, \`Decision: keep
    unconfirmed\`, or \`Decision: re-run\`.
`;

const DECISION_PATTERN = {
  accept: "accept",
  reject: "reject",
  "keep-unconfirmed": "keep[- ]unconfirmed",
  "re-run": "re-?run",
} as const;

export function graders(truth: DecideTruth): Record<string, string> {
  const lookahead = truth.reason.map((g) => `(?=[\\s\\S]*(?:${g.join("|")}))`).join("");
  return {
    "decision.md": [
      "---",
      "type: regex",
      `pattern: '^[\\s>*_#-]*decision[*_\\s]*:[*_\\s\`]*(?:${truth.decisions.map((d) => DECISION_PATTERN[d]).join("|")})\\b'`,
      "flags: im",
      "match: contains",
      "---",
      `The reply decides \`${truth.decisions.join("` or `")}\`. ${truth.note}`,
      "",
    ].join("\n"),
    "reason.md": [
      "---",
      "type: regex",
      `pattern: '^${lookahead.replaceAll("'", "''")}'`,
      "flags: i",
      "match: contains",
      "---",
      `The reply's reason names the trap. ${truth.note}`,
      "",
    ].join("\n"),
  };
}

export const program = new Command("gen-decide.ts")
  .description("Write the decide-* cases from the trap and domain tables")
  .action(async () => {
    const suite = join(import.meta.dir, "..");
    const old = globSync("decide-*", { cwd: suite }).map((d) => join(suite, d));
    if (old.length > 0) await $`rm -rf ${old}`;
    const cases = all();
    const writes = cases.flatMap((c) => {
      const files: Record<string, string> = {
        "case.yaml": CASE.replace("{name}", c.name),
        "prompt.md": c.prompt,
        "truth.json": `${JSON.stringify(c.truth, null, 2)}\n`,
      };
      for (const [file, text] of Object.entries(graders(c.truth)))
        files[join("graders", file)] = text;
      return Object.entries(files).map(([f, text]) => Bun.write(join(suite, c.name, f), text));
    });
    await Promise.all(writes);
    console.log(`wrote ${cases.length} cases`);
  });

if (import.meta.main) await program.parseAsync();
