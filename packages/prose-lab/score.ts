import { mkdir, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { $ } from "bun";
import { wilson } from "../evals/stats";
import { CEILING } from "./complexity";
import type { Flag, Hit, Label, Pattern, Score } from "./data";

export const MIN_POSITIVES = 8;
export const MIN_FILES = 4;
export const MIN_LABELED = 10;
export const FLOOR = 0.6;

type Located = Pick<Hit, "file" | "line" | "span">;

export function overlaps(a: Located, b: Located): boolean {
  return a.file === b.file && a.line === b.line && a.span[0] <= b.span[1] && b.span[0] <= a.span[1];
}

/**
 * A config that lints with `rules` alone as the `Lab` style, keeping the base
 * config's scopes, ignores, and vocabulary by linking its styles beside them.
 */
export async function labConfig(rules: readonly string[], base: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "prose-lab-"));
  const styles = join(dir, "styles");
  await mkdir(join(styles, "Lab"), { recursive: true });
  const shipped = join(dirname(base), "styles");
  await Promise.all([
    ...(await readdir(shipped)).map(
      (name) => $`ln -s ${join(shipped, name)} ${join(styles, name)}`,
    ),
    ...rules.map((rule) => Bun.write(join(styles, "Lab", basename(rule)), Bun.file(rule))),
  ]);
  const ini = (await Bun.file(base).text())
    .replace(/^StylesPath\s*=.*$/m, `StylesPath = ${styles}`)
    .replace(/^MinAlertLevel\s*=.*$/m, "MinAlertLevel = suggestion")
    .replaceAll(/^BasedOnStyles\s*=\s*\S.*$/gm, "BasedOnStyles = Lab")
    // A per-check level such as `ai-tells.Foo = warning` enables that check outside BasedOnStyles.
    .replaceAll(/^[A-Za-z][\w-]*\.\w+\s*=.*\n?/gm, "");
  const config = join(dir, ".vale.ini");
  await Bun.write(config, ini);
  return config;
}

export interface Evidence {
  positives: Located[];
  files: number;
  negatives: number;
}

export function evidence(slug: string, labels: readonly Label[], flags: readonly Flag[]): Evidence {
  const positives = [
    ...labels.filter((label) => label.pattern === slug && label.verdict === "right"),
    ...flags.filter((flag) => flag.pattern === slug),
  ];
  return {
    positives,
    files: new Set(positives.map((positive) => positive.file)).size,
    negatives: labels.filter((label) => label.pattern === slug && label.verdict === "wrong").length,
  };
}

export interface Judged {
  right: number;
  wrong: number;
  /** Judged hits that only a model's label decided. */
  byModel: number;
  unlabeled: Hit[];
}

/**
 * A hit on a span labeled bad prose is right, and one on a span labeled fine is
 * wrong, whatever check made it. The user's labels on a span override a model's.
 */
export function judge(
  hits: readonly Hit[],
  labels: readonly Label[],
  flags: readonly Flag[],
): Judged {
  let right = 0;
  let wrong = 0;
  let byModel = 0;
  const unlabeled: Hit[] = [];
  for (const hit of hits) {
    const touching = labels.filter((label) => overlaps(label, hit));
    const user = touching.filter((label) => label.by === "user");
    const deciding = user.length > 0 ? user : touching;
    const verdicts = deciding.map((label) => label.verdict);
    const flagged = flags.some((flag) => overlaps(flag, hit));
    const decided = flagged || verdicts.includes("right") || verdicts.includes("wrong");
    if (flagged || verdicts.includes("right")) right++;
    else if (verdicts.includes("wrong")) wrong++;
    else if (verdicts.length === 0) unlabeled.push(hit);
    if (decided && !flagged && user.length === 0) byModel++;
  }
  return { right, wrong, byModel, unlabeled };
}

export function score(
  pattern: string,
  candidate: string,
  hits: readonly Hit[],
  labels: readonly Label[],
  flags: readonly Flag[],
  words: number,
  complexity: number,
  ts: string,
): { score: Score; unlabeled: Hit[] } {
  const { right, wrong, byModel, unlabeled } = judge(hits, labels, flags);
  const { positives } = evidence(pattern, labels, flags);
  const covered = positives.filter((positive) => hits.some((hit) => overlaps(hit, positive)));
  const [low, high] = right + wrong === 0 ? [0, 1] : wilson(right, right + wrong);
  return {
    score: {
      pattern,
      candidate,
      hits: hits.length,
      right,
      wrong,
      byModel,
      low,
      high,
      recall: positives.length === 0 ? 0 : covered.length / positives.length,
      positives: positives.length,
      perThousand: words === 0 ? 0 : (hits.length / words) * 1000,
      complexity,
      ts,
    },
    unlabeled,
  };
}

export function clears(entry: Pick<Score, "right" | "wrong" | "low">): boolean {
  return entry.right + entry.wrong >= MIN_LABELED && entry.low >= FLOOR;
}

/** Meets the precision floor at a complexity under the ceiling. */
export function promotable(entry: Pick<Score, "right" | "wrong" | "low" | "complexity">): boolean {
  return clears(entry) && entry.complexity <= CEILING;
}

export type Stage = "collecting" | "generalizing" | "ready" | "shipped";

export function stage(pattern: Pattern, found: Evidence, top: Score | undefined): Stage {
  if (pattern.check !== undefined) return "shipped";
  if (found.positives.length < MIN_POSITIVES || found.files < MIN_FILES) return "collecting";
  return top !== undefined && promotable(top) ? "ready" : "generalizing";
}

/**
 * The candidate a promotion would pick: the simplest of those whose
 * interval overlaps the most precise one's, a precision difference the labels
 * don't resolve.
 */
export function best(scores: readonly Score[], pattern: string): Score | undefined {
  const ranked = scores
    .filter((entry) => entry.pattern === pattern)
    .toSorted((a, b) => (b.low === a.low ? b.recall - a.recall : b.low - a.low));
  const top = ranked[0];
  if (top === undefined) return undefined;
  return ranked
    .filter((entry) => entry.high >= top.low)
    .toSorted((a, b) => a.complexity - b.complexity)[0];
}

export interface HitDiff {
  kept: Hit[];
  dropped: Hit[];
  added: Hit[];
}

const lineKey = (hit: Hit) => `${hit.file}|${hit.line}`;

function covers(byLine: Map<string, Hit[]>, hit: Hit): boolean {
  return (byLine.get(lineKey(hit)) ?? []).some((other) => overlaps(other, hit));
}

/** How a candidate's hits differ from a baseline rule's, matching hits that overlap. */
export function diffHits(baseline: readonly Hit[], candidate: readonly Hit[]): HitDiff {
  const byBaseline = Map.groupBy(baseline, lineKey);
  const byCandidate = Map.groupBy(candidate, lineKey);
  return {
    kept: baseline.filter((hit) => covers(byCandidate, hit)),
    dropped: baseline.filter((hit) => !covers(byCandidate, hit)),
    added: candidate.filter((hit) => !covers(byBaseline, hit)),
  };
}
