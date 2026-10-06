import type { ApiContentBlock } from "claude-code";

export interface Category {
  category: string;
  hits: number;
}

export interface Score {
  words: number;
  hits: number;
  categories: Category[];
}

export interface Meter {
  turn: Score;
  generation: number;
  unavailable: boolean;
}

export interface MeterEvent {
  event: "voice.score" | "voice.unavailable";
  ok: boolean;
  detail: Record<string, unknown>;
}

/**
 * `status` is the line to show, `undefined` to clear it, or `null` to leave it as it is.
 */
export interface Outcome {
  event: MeterEvent;
  status: string | undefined | null;
}

const EMPTY: Score = { words: 0, hits: 0, categories: [] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCategory(value: unknown): value is Category {
  return isRecord(value) && typeof value.category === "string" && typeof value.hits === "number";
}

export function replyText(content: readonly ApiContentBlock[]): string {
  return content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n")
    .trim();
}

/**
 * Reads the prose group of `scan.ts score --json`; undefined when the output is not a report.
 */
export function parseReport(stdout: string): Score | undefined {
  let report: unknown;
  try {
    report = JSON.parse(stdout);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return undefined;
  }
  if (!isRecord(report) || !Array.isArray(report.groups)) return undefined;
  const prose: unknown = report.groups.find((group) => isRecord(group) && group.group === "prose");
  if (!isRecord(prose) || typeof prose.wordCount !== "number" || !Array.isArray(prose.categories)) {
    return undefined;
  }
  const categories = prose.categories
    .filter(isCategory)
    .map(({ category, hits }) => ({ category, hits }));
  return {
    words: prose.wordCount,
    hits: categories.reduce((sum, { hits }) => sum + hits, 0),
    categories,
  };
}

function combine(a: Score, b: Score): Score {
  const hits = new Map<string, number>();
  for (const { category, hits: n } of [...a.categories, ...b.categories]) {
    hits.set(category, (hits.get(category) ?? 0) + n);
  }
  return {
    words: a.words + b.words,
    hits: a.hits + b.hits,
    categories: [...hits].map(([category, n]) => ({ category, hits: n })),
  };
}

function density({ words, hits }: Score): number {
  return words === 0 ? 0 : (hits / words) * 1000;
}

function statusLine(score: Score): string {
  const rate = `voice ${Math.round(density(score))}/1k`;
  const top = score.categories.toSorted((a, b) => b.hits - a.hits)[0];
  return top === undefined ? rate : `${rate} · ${top.category}`;
}

export function createMeter(): Meter {
  return { turn: EMPTY, generation: 0, unavailable: false };
}

export function startTurn(meter: Meter): void {
  meter.turn = EMPTY;
  meter.generation++;
}

/**
 * Folds one row's scan into the meter. A scan that started in an earlier turn is logged but
 * left out of the current turn's line; a failed scan turns the meter off for the session.
 */
export function record(
  meter: Meter,
  generation: number,
  uuid: string,
  scan: Score | string,
): Outcome {
  if (typeof scan === "string") {
    meter.unavailable = true;
    return {
      event: { event: "voice.unavailable", ok: false, detail: { reason: scan } },
      status: undefined,
    };
  }
  const event: MeterEvent = {
    event: "voice.score",
    ok: true,
    detail: { uuid, density: density(scan), ...scan },
  };
  if (generation !== meter.generation) return { event, status: null };
  meter.turn = combine(meter.turn, scan);
  return { event, status: statusLine(meter.turn) };
}
