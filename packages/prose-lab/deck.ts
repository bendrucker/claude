import { type Flag, type Hit, hitId, type Label } from "./data";
import { FLOOR, interval, judge, settled } from "./score";

export const PROPOSED = "Model.Proposed";
/** One card in this many comes from the proposer while its check is undecided. */
const PROPOSAL_EVERY = 4;

export type Call = "enable" | "keep" | "retire" | "leave off" | "open";

export interface Rating {
  check: string;
  hits: number;
  right: number;
  wrong: number;
  low: number;
  high: number;
  /** Some hit fires under the plugin's own config. */
  shipped: boolean;
  call: Call;
  unlabeled: Hit[];
}

export function callFor(shipped: boolean, right: number, wrong: number): Call {
  if (!settled(right, wrong)) return "open";
  const above = interval(right, wrong)[0] >= FLOOR;
  if (shipped) return above ? "keep" : "retire";
  return above ? "enable" : "leave off";
}

/** One check's hits judged against the labels and flags on the files it touches. */
export function rate(
  check: string,
  group: readonly Hit[],
  labels: readonly Label[],
  flags: readonly Flag[],
): Rating {
  const files = new Set(group.map((hit) => hit.file));
  const { right, wrong, unlabeled } = judge(
    group,
    labels.filter((label) => files.has(label.file)),
    flags.filter((entry) => files.has(entry.file)),
  );
  const [low, high] = interval(right, wrong);
  const shipped = group.some((hit) => hit.shipped !== false);
  return {
    check,
    hits: group.length,
    right,
    wrong,
    low,
    high,
    shipped,
    call: callFor(shipped, right, wrong),
    unlabeled,
  };
}

export function rateAll(
  hits: readonly Hit[],
  labels: readonly Label[],
  flags: readonly Flag[],
): Rating[] {
  return [...Map.groupBy(hits, (hit) => hit.check)].map(([check, group]) =>
    rate(check, group, labels, flags),
  );
}

/** The unlabeled, unseen hit from the file the check's judged hits least cover. */
function pick(group: readonly Hit[], rating: Rating, seen: ReadonlySet<string>): Hit | undefined {
  const open = rating.unlabeled.filter((hit) => !seen.has(hitId(hit)));
  if (open.length === 0) return undefined;
  const pending = new Set(rating.unlabeled);
  const judged = Map.groupBy(
    group.filter((hit) => !pending.has(hit)),
    (hit) => hit.file,
  );
  const weight = (hit: Hit): number => judged.get(hit.file)?.length ?? 0;
  return open.toSorted((a, b) => weight(a) - weight(b))[0];
}

/** Widest interval first, then fewest judged hits, then by name. */
const MAX_TO_CALL = 200;

/** Votes a check needs for a call if every one goes the way its labels lean, which for an unlabeled check is right. */
export function toCall({ right, wrong }: Pick<Rating, "right" | "wrong">): number {
  const above = right + wrong === 0 || right / (right + wrong) >= FLOOR;
  const steps = Array.from({ length: MAX_TO_CALL }, (_, k) => k);
  return (
    steps.find((k) => (above ? settled(right + k, wrong) : settled(right, wrong + k))) ??
    MAX_TO_CALL
  );
}

function priority(a: Rating, b: Rating): number {
  const votes = toCall(a) - toCall(b);
  if (votes !== 0) return votes;
  const judged = b.right + b.wrong - (a.right + a.wrong);
  return judged === 0 ? a.check.localeCompare(b.check) : judged;
}

/**
 * Picks a proposer hit every `PROPOSAL_EVERY`th card, and otherwise a hit from
 * the undecided check fewest votes from a call.
 */
export function next(
  hits: readonly Hit[],
  labels: readonly Label[],
  flags: readonly Flag[],
  seen: ReadonlySet<string>,
): Hit | undefined {
  const groups = Map.groupBy(hits, (hit) => hit.check);
  const candidates = [...groups]
    .flatMap(([check, group]) => {
      const rating = rate(check, group, labels, flags);
      const hit = rating.call === "open" ? pick(group, rating, seen) : undefined;
      return hit === undefined ? [] : [{ rating, hit }];
    })
    .toSorted((a, b) => priority(a.rating, b.rating));
  const proposal = candidates.find((entry) => entry.rating.check === PROPOSED);
  if (proposal !== undefined && seen.size % PROPOSAL_EVERY === PROPOSAL_EVERY - 1)
    return proposal.hit;
  return candidates.find((entry) => entry.rating.check !== PROPOSED)?.hit ?? proposal?.hit;
}
