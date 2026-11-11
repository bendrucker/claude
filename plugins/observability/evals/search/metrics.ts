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
