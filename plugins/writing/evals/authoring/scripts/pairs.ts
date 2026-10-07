import { z } from "zod";

export const SURFACES = ["pr", "issue", "doc", "skill"] as const;
export const Surface = z.enum(SURFACES);
export type Surface = z.infer<typeof Surface>;

export const Key = z.enum(["a", "b"]);
export type Key = z.infer<typeof Key>;

export const Pick = z.enum(["a", "b", "tie"]);
export type Pick = z.infer<typeof Pick>;

const Id = z.string().regex(/^[\w-]+$/);

/** Where a draft came from: a run in a result column, or Ben's original. */
export const Source = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("run"),
    /** Label for the result column, such as `base` or a candidate branch. */
    column: z.string(),
    arm: z.string(),
    run: z.number().int().nonnegative(),
  }),
  z.object({ kind: z.literal("original"), url: z.string() }),
]);
export type Source = z.infer<typeof Source>;

export const Draft = z.object({ source: Source, text: z.string() });
export type Draft = z.infer<typeof Draft>;

export const Pair = z.object({
  id: Id,
  case: z.string(),
  surface: Surface,
  brief: z.string(),
  a: Draft,
  b: Draft,
});
export type Pair = z.infer<typeof Pair>;

export const Span = z.object({
  key: Key,
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  text: z.string(),
  severity: z.enum(["critical", "minor", "praise"]),
  note: z.string().default(""),
});
export type Span = z.infer<typeof Span>;

/** Ben's verdict on one pair, keyed by the pair's stable a/b, never by screen side. */
export const Label = z.object({
  id: Id,
  pick: Pick,
  /** Which key the labeler rendered on the left, to audit position bias. */
  left: Key,
  spans: z.array(Span).default([]),
  notes: z.string().default(""),
});
export type Label = z.infer<typeof Label>;

export const Judgment = z.object({
  id: Id,
  pick: Pick,
  left: Key,
  reason: z.string().default(""),
  /** Hash of the judge prompt, so verdicts from different prompts never pool. */
  prompt: z.string(),
  model: z.string(),
  /** Hash of everything the call depended on, so a rerun reuses a verdict only on a full match. */
  key: z.string().optional(),
});
export type Judgment = z.infer<typeof Judgment>;

/** The fields a Judgment and a Label share, which is all a win rate needs. */
export const Verdict = z.object({ id: Id, pick: Pick, left: Key });
export type Verdict = z.infer<typeof Verdict>;
