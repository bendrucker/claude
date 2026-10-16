import { mean } from "simple-statistics";
import { z } from "zod";
import { units } from "./frame";
import { listBlocks } from "./ranking";

const Patterns = z.array(z.string());

export const OffCpuTruth = z.object({
  kind: z.literal("offcpu"),
  profile: z.string(),
  checks: z.array(
    z.object({
      id: z.string(),
      note: z.string(),
      /** Pattern groups that one paragraph or list item of the reply must each match. */
      all: z.array(Patterns),
    }),
  ),
  /** An entry naming one of these is the right lead or a profiling step, not a trap. */
  leads: Patterns,
  traps: z.array(z.object({ id: z.string(), note: z.string(), patterns: Patterns })),
});
export type OffCpuTruth = z.output<typeof OffCpuTruth>;

export const TRAP_RANKS = 2;

const any = (patterns: string[]) => {
  const res = patterns.map((p) => new RegExp(p, "i"));
  return (text: string) => res.some((re) => re.test(text));
};

/** The reply's last ranked list: numbered items or a table ranked by its first column. */
export function rankedList(reply: string): string[] {
  return listBlocks(reply).findLast((b) => b.kind !== "bullet")?.entries ?? [];
}

export interface OffCpuScore {
  checks: Record<string, boolean>;
  /** Traps ranked in the first `TRAP_RANKS` entries. */
  traps: string[];
  /** Mean of the checks and whether the first `TRAP_RANKS` entries are trap-free. */
  composite: number;
}

export function scoreOffCpu(reply: string, truth: OffCpuTruth): OffCpuScore {
  const pieces = units(reply);
  const checks = Object.fromEntries(
    truth.checks.map((c) => {
      const groups = c.all.map(any);
      return [c.id, pieces.some((u) => groups.every((g) => g(u)))];
    }),
  );
  const lead = any(truth.leads);
  const top = rankedList(reply)
    .slice(0, TRAP_RANKS)
    .filter((e) => !lead(e));
  const traps = truth.traps.filter((t) => top.some(any(t.patterns))).map((t) => t.id);
  const parts = [...Object.values(checks).map(Number), Number(traps.length === 0)];
  return { checks, traps, composite: mean(parts) };
}
