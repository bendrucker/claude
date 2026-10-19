// Retrieval metrics for one ranked result list against its labeled relevant set.

export interface Labeled {
  id: string;
  query: string;
  relevant: string[];
  tags: string[];
}

export interface Scored {
  /** Relevant results in the top 5, over 5. */
  p5: number;
  /** Relevant results in the top 10, over the relevant set (capped at 10). */
  recall10: number;
  /** 1 / rank of the first relevant result, 0 when none is in the list. */
  rr: number;
}

export function score(ranked: string[], relevant: string[]): Scored {
  const want = new Set(relevant);
  const hits = (k: number) => ranked.slice(0, k).filter((r) => want.has(r)).length;
  const first = ranked.findIndex((r) => want.has(r));
  return {
    p5: hits(5) / 5,
    recall10: want.size === 0 ? 0 : hits(10) / Math.min(want.size, 10),
    rr: first === -1 ? 0 : 1 / (first + 1),
  };
}

export function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function median(xs: number[]): number {
  const s = xs.toSorted((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  if (s.length % 2 === 1) return s[m] ?? 0;
  return s.length === 0 ? 0 : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
}

/** Paired sign-flip permutation test on per-query differences, two-sided. */
export function pairedP(a: number[], b: number[], rounds = 10_000, seed = 1): number {
  const d = a.map((x, i) => x - (b[i] ?? 0));
  const observed = Math.abs(mean(d));
  let state = seed;
  const rand = () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
  let extreme = 0;
  for (let r = 0; r < rounds; r++) {
    if (Math.abs(mean(d.map((x) => (rand() < 0.5 ? -x : x)))) >= observed - 1e-12) extreme++;
  }
  return (extreme + 1) / (rounds + 1);
}
