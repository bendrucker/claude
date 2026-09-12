import { sizeReason } from "../../../hooks/gate";

export const SIZE_LIMIT = 10_000;
export const TARGET_CHARS = 8_000;

const count = (n: number): string => n.toLocaleString("en-US");

// The candidate deny text: states the measured size and a target below the limit,
// so the rework is one rewrite toward a number rather than an edit-and-measure
// loop that stops at the first count under the threshold.
export function targetReason(length: number): string {
  return (
    `This plan is ${count(length)} characters, over the ${count(SIZE_LIMIT)}-character limit. ` +
    `Cut it to about ${count(TARGET_CHARS)} characters so it keeps room to grow. ` +
    "Move supporting detail into <plan>-<topic>.md files the plan links " +
    "(<plan>-decisions.md is the common one), or split the work into smaller plans. " +
    "The limit counts characters, not bytes."
  );
}

/** Each arm maps the denied plan to the deny reason the session receives. */
export const ARMS: Readonly<Record<string, (plan: string) => string>> = {
  current: () => sizeReason(0),
  target: (plan) => targetReason(plan.length),
};

export function armReason(arm: string, plan: string): string {
  const reason = ARMS[arm];
  if (reason === undefined) {
    throw new Error(`unknown arm ${arm}; choose from ${Object.keys(ARMS).join(", ")}`);
  }
  return reason(plan);
}
