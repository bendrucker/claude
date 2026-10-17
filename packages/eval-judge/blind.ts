/** A stable draft identity, independent of where the judge saw it. */
export type Side = "a" | "b";
export type Pick = Side | "tie";
/** The judge's answer in prompt order: "1" is the left slot. */
export type Slot = "1" | "2" | "tie";

export interface Verdict {
  pick: Slot;
  reason: string;
}

export interface Blinded {
  pick: Pick;
  /** Which side the first call rendered in the left slot, to audit position bias. */
  left: Side;
  reason: string;
}

export function other(side: Side): Side {
  return side === "a" ? "b" : "a";
}

/** Which side sits in the left slot of the judge prompt. */
export function blind(flip: boolean): Side {
  return flip ? "b" : "a";
}

export function deblind(slot: Slot, left: Side): Pick {
  if (slot === "tie") return "tie";
  return slot === "1" ? left : other(left);
}

/**
 * Judges a pair with a random side on the left and maps the verdict back to a/b. `swap` judges
 * it again in the other slot order and records a tie when the two picks disagree, since a judge
 * that follows position is no signal either way.
 */
export async function judgeBlind(
  call: (left: Side) => Promise<Verdict>,
  options: { swap: boolean; rng?: () => number },
): Promise<Blinded> {
  const rng = options.rng ?? Math.random;
  const left = blind(rng() < 0.5);
  const primary = await call(left);
  const pick = deblind(primary.pick, left);
  if (!options.swap) return { pick, left, reason: primary.reason };

  const swapped = other(left);
  const secondary = await call(swapped);
  const swappedPick = deblind(secondary.pick, swapped);
  if (swappedPick === pick) return { pick, left, reason: primary.reason };
  return {
    pick: "tie",
    left,
    reason: `swap disagreement (${pick} then ${swappedPick}): ${primary.reason} / ${secondary.reason}`,
  };
}
