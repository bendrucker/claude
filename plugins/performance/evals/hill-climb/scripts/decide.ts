import { z } from "zod";

export const DECISIONS = ["accept", "reject", "keep-unconfirmed", "re-run"] as const;
export type Decision = (typeof DECISIONS)[number];

export const DecideTruth = z.object({
  kind: z.literal("decide"),
  trap: z.string(),
  /** The decisions the evidence supports, any one of which is right. */
  decisions: z.array(z.enum(DECISIONS)).min(1),
  note: z.string(),
  /** Pattern groups the reply must each match somewhere for the reason to name the trap. */
  reason: z.array(z.array(z.string())),
});
export type DecideTruth = z.output<typeof DecideTruth>;

const LINE = /^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(accept|reject|keep[- ]unconfirmed|re-?run)\b/gim;

/** The decision on the reply's last `Decision:` line. */
export function decisionOf(reply: string): Decision | undefined {
  const last = [...reply.matchAll(LINE)].at(-1)?.[1]?.toLowerCase();
  if (last === undefined) return undefined;
  if (last.startsWith("keep")) return "keep-unconfirmed";
  if (last === "accept" || last === "reject") return last;
  return "re-run";
}

export function namesTrap(reply: string, groups: string[][]): boolean {
  return groups.every((g) => g.some((p) => new RegExp(p, "i").test(reply)));
}

export interface DecideScore {
  decision: Decision | undefined;
  correct: boolean;
  reason: boolean;
  /** Half for the right decision, half more when its reason names the trap. */
  composite: number;
}

export function scoreDecide(reply: string, truth: DecideTruth): DecideScore {
  const decision = decisionOf(reply);
  const correct = decision !== undefined && truth.decisions.includes(decision);
  const reason = correct && namesTrap(reply, truth.reason);
  return { decision, correct, reason, composite: (Number(correct) + Number(reason)) / 2 };
}
