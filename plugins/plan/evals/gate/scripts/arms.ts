import { SIZE_THRESHOLD as SIZE_LIMIT, sizeReason } from "../../../hooks/gate";

export { SIZE_THRESHOLD as SIZE_LIMIT } from "../../../hooks/gate";
export const TARGET_CHARS = 8_000;

const count = (n: number): string => n.toLocaleString("en-US");

const MOVE_DETAIL =
  "Move supporting detail into <plan>-<topic>.md files the plan links " +
  "(<plan>-decisions.md is the common one), or split the work into smaller plans. " +
  "The limit counts characters, not bytes.";

// In the first Opus run the target number turned the rework into a precision loop aimed at 8,000.
export function targetReason(length: number): string {
  return (
    `This plan is ${count(length)} characters, over the ${count(SIZE_LIMIT)}-character limit. ` +
    `Cut it to about ${count(TARGET_CHARS)} characters so it keeps room to grow. ${MOVE_DETAIL}`
  );
}

// States the measured size only, so the session knows how far over it is
// without a second number to tune toward.
export function countReason(length: number): string {
  return `This plan is ${count(length)} characters, over the ${count(SIZE_LIMIT)}-character limit. ${MOVE_DETAIL}`;
}

export const ARMS: Readonly<Record<string, (plan: string) => string>> = {
  current: () => sizeReason(0),
  target: (plan) => targetReason(plan.length),
  count: (plan) => countReason(plan.length),
};

export function armReason(arm: string, plan: string): string {
  const reason = ARMS[arm];
  if (reason === undefined) {
    throw new Error(`unknown arm ${arm}; choose from ${Object.keys(ARMS).join(", ")}`);
  }
  return reason(plan);
}
