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
  /** A candidate whose headline matches one of these targets the true wall-time lead. */
  primary: z.object({ note: z.string(), patterns: Patterns }),
  traps: z.array(z.object({ id: z.string(), note: z.string(), patterns: Patterns })),
});
export type OffCpuTruth = z.output<typeof OffCpuTruth>;

export const TRAP_RANKS = 2;

/** Spreading CPU work across cores, which targets the core count. */
export const SPREADS_WORK = ["parallel", "concurren", "worker", "pipelin", "goroutine", "fan.?out"];

/** What a candidate targets: its bold title, or its first sentence. */
export function headline(entry: string): string {
  const bold = /^\s*\*\*(.+?)\*\*/.exec(entry)?.[1];
  return bold ?? entry.split(/(?<=[.:])\s|\n/)[0] ?? entry;
}

const any = (patterns: string[]) => {
  const res = patterns.map((p) => new RegExp(p, "i"));
  return (text: string) => res.some((re) => re.test(text));
};

/** An entry that measures before ranking, which isn't a candidate. */
const PROFILING_STEP = any([
  String.raw`^\W*(re-?)?profil`,
  String.raw`^\W*(measure|confirm|record|capture|take|run) `,
  String.raw`\b(off.?cpu|block|mutex|wall.?clock) profile\b`,
  "strace",
  "go tool trace",
]);

/** The reply's last ranked list: numbered items or a table ranked by its first column. */
export function rankedList(reply: string): string[] {
  return listBlocks(reply).findLast((b) => b.kind !== "bullet")?.entries ?? [];
}

export interface OffCpuScore {
  checks: Record<string, boolean>;
  /** One trap per entry in the first `TRAP_RANKS` whose headline is a micro-optimization. */
  traps: string[];
  /** 1-based rank of the first candidate targeting the true lead, or the list length plus one. */
  leadRank: number;
  /** Mean of the checks, whether the first `TRAP_RANKS` entries are trap-free, and the lead at #1. */
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
  const notMicro = any([...truth.leads, ...SPREADS_WORK]);
  const traps = rankedList(reply)
    .slice(0, TRAP_RANKS)
    .map(headline)
    .filter((h) => !notMicro(h))
    .flatMap((h) => truth.traps.find((t) => any(t.patterns)(h))?.id ?? []);
  const primary = any(truth.primary.patterns);
  const candidates = rankedList(reply)
    .map(headline)
    .filter((h) => primary(h) || !PROFILING_STEP(h));
  const found = candidates.findIndex(primary);
  const leadRank = found === -1 ? candidates.length + 1 : found + 1;
  const parts = [
    ...Object.values(checks).map(Number),
    Number(traps.length === 0),
    Number(leadRank === 1),
  ];
  return { checks, traps, leadRank, composite: mean(parts) };
}
