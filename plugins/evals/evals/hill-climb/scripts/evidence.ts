import { z } from "zod";
import type { Cell, Column } from "../../../../../packages/evals/column";
import { pFloor, pValue } from "../../../../../packages/evals/stats";
import truthFile from "../truth.json";

export const DECISIONS = ["accept", "reject", "more-runs", "stall", "stop", "re-baseline"] as const;
export type Decision = (typeof DECISIONS)[number];

export const HARNESSES = ["native", "pydantic", "csv"] as const;
export type Harness = (typeof HARNESSES)[number];

export const ARMS = ["with", "without"] as const;
export type Arm = (typeof ARMS)[number];

export const ALPHA = 0.1;

/** A pair of counts, with arm first and without arm second. */
type Pair = [withArm: number, withoutArm: number];

const Pair = z.tuple([z.number(), z.number()]);
const Ref = z.object({ case: z.string(), grader: z.string() });
const Truth = z.object({
  domains: z.array(
    z.object({
      id: z.string(),
      artifact: z.string(),
      target: z.string(),
      suite: z.string(),
      hypothesis: z.string(),
      target_grader: Ref,
      guards: z.array(Ref),
      other: Ref,
      cases: z.array(
        z.object({
          id: z.string(),
          split: z.enum(["dev", "holdout"]),
          graders: z.array(z.object({ name: z.string(), base: Pair })),
        }),
      ),
    }),
  ),
  traps: z.array(
    z.object({
      id: z.string(),
      expected: z.enum(DECISIONS),
      note: z.string(),
      reason: z.array(z.array(z.string())),
    }),
  ),
});

export const truth = Truth.parse(truthFile);
export type Domain = (typeof truth.domains)[number];
export type Trap = (typeof truth.traps)[number];

export const key = (ref: { case: string; grader: string }): string => `${ref.case}/${ref.grader}`;

/** What a trap plants on top of a flat candidate, by `<case>/<grader>` key. */
export interface Plan {
  nBase: number;
  nCand: number;
  base?: Record<string, Pair>;
  cand?: Record<string, Pair>;
  /** Candidate runs per arm lost to a session limit, by dev case. */
  errored?: Record<string, number>;
  /** The candidate's multiplier on seconds and cost per run, by arm. */
  factors?: { seconds: Pair; cost: Pair };
  /** Final-commit holdout counts, replacing the base's. Its presence runs the holdout pair. */
  holdout?: Record<string, Pair>;
  drift?: "version" | "model";
  /** Every dev grader passes every run on both arms. */
  saturated?: boolean;
  candidate: number;
  history: string[];
  notes: string[];
}

interface Refs {
  target: string;
  guards: string[];
  other: string;
  domain: Domain;
}

const holdoutKeys = (domain: Domain) =>
  domain.cases
    .filter((c) => c.split === "holdout")
    .flatMap((c) => c.graders.map((g) => ({ key: `${c.id}/${g.name}`, base: g.base })));

const flat: Pick<Plan, "nBase" | "nCand" | "candidate" | "history" | "notes"> = {
  nBase: 6,
  nCand: 6,
  candidate: 1,
  history: ["Candidate 1 of this climb. Nothing was accepted or rejected before it."],
  notes: [],
};

export const PLANS: Record<string, (r: Refs) => Plan> = {
  "control-star": (r) => ({ ...flat, cand: { [r.target]: [6, 5] } }),
  underpowered: (r) => ({
    ...flat,
    nBase: 3,
    nCand: 3,
    base: { [r.target]: [0, 0] },
    cand: { [r.target]: [3, 0] },
    notes: ["Budget: one replicate per column, `--runs 3`."],
  }),
  "off-target": (r) => ({
    ...flat,
    base: { [r.other]: [2, 3] },
    cand: { [r.other]: [6, 3] },
  }),
  "guard-drop": (r) => ({
    ...flat,
    cand: { [r.target]: [6, 1], [r.guards[0] ?? ""]: [1, 4] },
    notes: [
      `Traces read: the 5 failing runs of \`${r.guards[0]}\` follow the candidate's new instruction.`,
    ],
  }),
  "holdout-fell": (r) => ({
    ...flat,
    cand: { [r.target]: [6, 1] },
    holdout: Object.fromEntries(
      holdoutKeys(r.domain).map(({ key: k, base }) => [k, [Math.max(0, base[0] - 4), base[1]]]),
    ),
    notes: ["Holdout: run once on the base and on this candidate as the final commit."],
  }),
  "quota-void": (r) => ({
    ...flat,
    errored: Object.fromEntries(
      r.domain.cases
        .filter((c) => c.split === "dev")
        .filter((_, i) => i !== 1)
        .map((c) => [c.id, 3]),
    ),
    base: { [r.target]: [1, 1] },
    cand: { [r.target]: [3, 1] },
    notes: [
      `Candidate results \`cand-2\` stopped at the session limit during \`${r.target.split("/")[0]}\` and \`${r.guards[1]?.split("/")[0]}\`: 3 runs of each arm errored.`,
    ],
  }),
  "second-null": (r) => ({
    ...flat,
    candidate: 3,
    history: [
      `Candidate 1: accepted and merged. Candidate 2: null, target \`${r.target}\` 2/6 to 3/6 with no star, rejected and the PR closed. Candidate 3 is this one.`,
    ],
  }),
  saturated: () => ({
    ...flat,
    saturated: true,
    notes: [
      "Noise runs (two unchanged dev replicates of 3 runs a side): dev score 1.00 on the with arm and 1.00 on the without arm in both.",
    ],
  }),
  "efficiency-unregistered": () => ({
    ...flat,
    factors: { seconds: [0.62, 1], cost: [0.7, 1] },
  }),
  "version-drift": (r) => ({
    ...flat,
    cand: { [r.target]: [6, 1] },
    drift: r.domain.id === "skill" || r.domain.id === "rule" ? "version" : "model",
  }),
  "clean-accept": (r) => {
    const [first] = holdoutKeys(r.domain);
    return {
      ...flat,
      cand: { [r.target]: [6, 1] },
      holdout: first === undefined ? {} : { [first.key]: [first.base[0] + 1, first.base[1]] },
      notes: ["Holdout: run once on the base and on this candidate as the final commit."],
    };
  },
};

export const BASE_VERSION = { version: "2.1.230", model: "claude-sonnet-5-5" };

export function candidateVersion(drift: Plan["drift"]): typeof BASE_VERSION {
  if (drift === "version") return { ...BASE_VERSION, version: "2.1.236" };
  if (drift === "model") return { ...BASE_VERSION, model: "claude-opus-5-1" };
  return BASE_VERSION;
}

/** One arm of one case on one side of the comparison. */
export interface Side {
  runs: number;
  passes: Record<string, number>;
  seconds: number[];
  cost: number[];
  words: number[];
  turns: number[];
  tokens: number[];
}

export interface BlockCase {
  id: string;
  split: "dev" | "holdout";
  graders: string[];
  /** Candidate runs lost to errors on each arm. */
  errored: number;
  base: Record<Arm, Side>;
  cand: Record<Arm, Side>;
}

export interface Block {
  cases: BlockCase[];
  labels: [base: string, candidate: string];
}

const NOISE_BASE = [0.92, 1.06, 1.0, 1.1, 0.95, 0.97];
const NOISE_CAND = [1.05, 0.96, 1.04, 0.93, 1.08, 0.94];
const SECONDS = [22, 18, 25, 20, 19];
const COST = [0.09, 0.07, 0.11, 0.08, 0.075];
const WITHOUT = { seconds: 0.75, cost: 0.65 };

const series = (mean: number, noise: number[], n: number, digits = 4) =>
  noise.slice(0, n).map((x) => Number((mean * x).toFixed(digits)));

const scale = (k: number, from: number, to: number) => Math.round((k * to) / from);

function side(
  runs: number,
  passes: Record<string, number>,
  caseIndex: number,
  arm: Arm,
  noise: number[],
  factor: { seconds: number; cost: number },
): Side {
  const w = arm === "with";
  return {
    runs,
    passes,
    seconds: series(
      (SECONDS[caseIndex] ?? 20) * (w ? 1 : WITHOUT.seconds) * factor.seconds,
      noise,
      runs,
    ),
    cost: series((COST[caseIndex] ?? 0.08) * (w ? 1 : WITHOUT.cost) * factor.cost, noise, runs),
    words: series(w ? 180 : 140, NOISE_BASE, runs, 0),
    turns: series(w ? 3 : 2, NOISE_BASE, runs, 0),
    tokens: series(w ? 900 : 700, NOISE_BASE, runs, 0),
  };
}

function block(domain: Domain, plan: Plan, split: "dev" | "holdout"): Block {
  const cases = domain.cases.flatMap((c, caseIndex): BlockCase[] => {
    if (c.split !== split) return [];
    const dev = split === "dev";
    const errored = dev ? (plan.errored?.[c.id] ?? 0) : 0;
    const nBase = dev ? plan.nBase : 6;
    const nCand = (dev ? plan.nCand : 6) - errored;
    const sides = (arm: Arm, i: number) => {
      const basePasses: Record<string, number> = {};
      const candPasses: Record<string, number> = {};
      for (const g of c.graders) {
        const k = `${c.id}/${g.name}`;
        const stored = scale(g.base[i] ?? 0, 6, nBase);
        const base = plan.saturated === true && dev ? nBase : (plan.base?.[k]?.[i] ?? stored);
        basePasses[g.name] = base;
        const given = dev ? plan.cand?.[k]?.[i] : plan.holdout?.[k]?.[i];
        candPasses[g.name] =
          plan.saturated === true && dev
            ? nCand
            : (given ?? (dev ? scale(base, nBase, nCand) : (g.base[i] ?? 0)));
      }
      const factor = dev
        ? {
            seconds: plan.factors?.seconds[i] ?? 1,
            cost: plan.factors?.cost[i] ?? 1,
          }
        : { seconds: 1, cost: 1 };
      return [
        side(nBase, basePasses, caseIndex, arm, NOISE_BASE, { seconds: 1, cost: 1 }),
        side(nCand, candPasses, caseIndex, arm, NOISE_CAND, factor),
      ] as const;
    };
    const [baseWith, candWith] = sides("with", 0);
    const [baseWithout, candWithout] = sides("without", 1);
    return [
      {
        id: c.id,
        split,
        graders: c.graders.map((g) => g.name),
        errored,
        base: { with: baseWith, without: baseWithout },
        cand: { with: candWith, without: candWithout },
      },
    ];
  });
  return { cases, labels: split === "dev" ? ["base", "candidate"] : ["base", "final"] };
}

export interface Evidence {
  trap: Trap;
  domain: Domain;
  harness: Harness;
  split: "dev" | "holdout";
  name: string;
  plan: Plan;
  dev: Block;
  holdout: Block | undefined;
  sha: string;
  baseVersion: typeof BASE_VERSION;
  candVersion: typeof BASE_VERSION;
}

export function evidence(
  trap: Trap,
  domain: Domain,
  harness: Harness,
  split: "dev" | "holdout",
  k: number,
): Evidence {
  const make = PLANS[trap.id];
  if (make === undefined) throw new Error(`no plan for trap ${trap.id}`);
  const refs: Refs = {
    target: key(domain.target_grader),
    guards: domain.guards.map(key),
    other: key(domain.other),
    domain,
  };
  const plan = make(refs);
  return {
    trap,
    domain,
    harness,
    split,
    name: `decide-${trap.id}-${domain.id}`,
    plan,
    dev: block(domain, plan, "dev"),
    holdout: plan.holdout === undefined ? undefined : block(domain, plan, "holdout"),
    sha: (0x3f9c1ae + k * 0x1234567).toString(16).slice(-7).padStart(7, "0"),
    baseVersion: BASE_VERSION,
    candVersion: candidateVersion(plan.drift),
  };
}

/**
 * Every trap on three of the four domains, skipping a different domain per trap. The third
 * appearance is the holdout, and the harness rotates across a trap's three appearances.
 */
export function all(): Evidence[] {
  return truth.traps.flatMap((trap, t) =>
    truth.domains
      .filter((_, d) => d !== t % truth.domains.length)
      .map((domain, v) =>
        evidence(
          trap,
          domain,
          HARNESSES[(t + v) % HARNESSES.length] ?? "native",
          v === 2 ? "holdout" : "dev",
          t * 3 + v,
        ),
      ),
  );
}

export const flags = (runs: number, passes: number): boolean[] =>
  Array.from({ length: runs }, (_, i) => i < passes);

const average = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Each run's case score: the share of the case's graders it passes. */
export function scores(c: BlockCase, s: Side): number[] {
  return Array.from({ length: s.runs }, (_, i) =>
    average(c.graders.map((g) => ((s.passes[g] ?? 0) > i ? 1 : 0))),
  );
}

export function column(b: Block, which: "base" | "cand"): Column {
  const col: Column = new Map();
  for (const c of b.cases) {
    for (const arm of ARMS) {
      const s = c[which][arm];
      const cell: Cell = {
        graders: new Map(c.graders.map((g) => [g, flags(s.runs, s.passes[g] ?? 0)])),
        scores: scores(c, s),
        errored: which === "cand" ? c.errored : 0,
        words: s.words,
        turns: s.turns,
        seconds: s.seconds,
        tokens: s.tokens,
        cost: s.cost,
      };
      col.set(`${c.id}/${arm}`, cell);
    }
  }
  return col;
}

export interface Compared {
  key: string;
  /** Baseline and candidate mean. */
  base: number;
  cand: number;
  p: number;
  mark: "*" | "†" | "";
}

function compareSeries(k: string, base: number[], cand: number[]): Compared {
  const p = pValue(base, cand);
  const underpowered = pFloor(base.length, cand.length) >= ALPHA;
  let mark: Compared["mark"] = "";
  if (underpowered) mark = "†";
  else if (p < ALPHA) mark = "*";
  return { key: k, base: average(base), cand: average(cand), p, mark };
}

/** Every grader and per-run measure of a block, compared the way `compare.ts` marks a cell. */
export function compared(b: Block): Compared[] {
  return b.cases.flatMap((c) =>
    ARMS.flatMap((arm) => {
      const base = c.base[arm];
      const cand = c.cand[arm];
      return [
        ...c.graders.map((g) =>
          compareSeries(
            `${c.id}/${arm}/${g}`,
            flags(base.runs, base.passes[g] ?? 0).map(Number),
            flags(cand.runs, cand.passes[g] ?? 0).map(Number),
          ),
        ),
        compareSeries(`${c.id}/${arm}/seconds`, base.seconds, cand.seconds),
        compareSeries(`${c.id}/${arm}/cost`, base.cost, cand.cost),
      ];
    }),
  );
}

/** The case-score rows, which `compare.ts` stars before any grader. */
export function comparedScores(b: Block): Compared[] {
  return b.cases.flatMap((c) =>
    ARMS.map((arm) =>
      compareSeries(`${c.id}/${arm}/score`, scores(c, c.base[arm]), scores(c, c.cand[arm])),
    ),
  );
}
