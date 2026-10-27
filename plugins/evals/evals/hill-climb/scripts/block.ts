import type { Cell, Column } from "../../../../../packages/evals/column";
import { pValue } from "../../../../../packages/evals/stats";

export const ARMS = ["with", "without"] as const;
export type Arm = (typeof ARMS)[number];

export const ALPHA = 0.1;

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

export const flags = (runs: number, passes: number): boolean[] =>
  Array.from({ length: runs }, (_, i) => i < passes);

export const average = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

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

export const p3 = (base: number[], cand: number[]): string => pValue(base, cand).toFixed(3);

export const graderP = (b: Side, c: Side, g: string): string =>
  p3(flags(b.runs, b.passes[g] ?? 0).map(Number), flags(c.runs, c.passes[g] ?? 0).map(Number));
