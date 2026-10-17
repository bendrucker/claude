import { z } from "zod";
import { listBlocks } from "./ranking";

const Patterns = z.array(z.string());

export const OffCpuTruth = z.object({
  kind: z.literal("offcpu"),
  profile: z.string(),
  checks: z.array(
    z.object({
      id: z.string(),
      note: z.string(),
      /** Pattern groups that one line of the reply must each match. */
      all: z.array(Patterns),
    }),
  ),
  /** An entry naming one of these is the right lead or a profiling step, not a trap. */
  leads: Patterns,
  /** A candidate whose headline matches one of these targets the true wall-time lead. */
  primary: z.object({
    note: z.string(),
    patterns: Patterns,
    /** A headline matching `headline` targets the lead only when its entry also matches `body`. */
    cited: z.object({ headline: Patterns, body: Patterns }).optional(),
  }),
  traps: z.array(z.object({ id: z.string(), note: z.string(), patterns: Patterns })),
});
export type OffCpuTruth = z.output<typeof OffCpuTruth>;

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
  String.raw`^\W*(measure|confirm|record|capture|take) `,
  String.raw`^\W*run\b[^.]{0,40}(profil|trace|bench|timing)`,
  String.raw`\b(off.?cpu|block|mutex|wall.?clock) profile\b`,
  "strace",
  "go tool trace",
]);

/** The reply's last ranked list: numbered items or a table ranked by its first column. */
export function rankedList(reply: string): string[] {
  return listBlocks(reply).findLast((b) => b.kind !== "bullet")?.entries ?? [];
}

/**
 * The 1-based rank of the first candidate whose headline targets the true lead, skipping
 * profiling steps, or the list length plus one when none does.
 */
export function leadRank(reply: string, truth: OffCpuTruth): number {
  const named = any(truth.primary.patterns);
  const { cited } = truth.primary;
  const citedHeadline = any(cited?.headline ?? []);
  const citedBody = any(cited?.body ?? []);
  const primary = (entry: string) =>
    named(headline(entry)) || (citedHeadline(headline(entry)) && citedBody(entry));
  const candidates = rankedList(reply).filter((e) => primary(e) || !PROFILING_STEP(headline(e)));
  const found = candidates.findIndex(primary);
  return found === -1 ? candidates.length + 1 : found + 1;
}
