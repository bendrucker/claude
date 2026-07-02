/**
 * The judge verdict contract. One verdict per introduced comment. The taxonomy
 * is the corpus-validated v1 set plus `voice` for the rewrite case. The judge
 * must never trim the two justified comment types (what-on-dense, why-on-simple)
 * or genuine design rationale.
 */

/**
 * Slop categories, in descending corpus frequency. `null` category accompanies
 * `action: "keep"`.
 *
 * - `restate-the-what`: paraphrases simple adjacent code, adds no reason.
 * - `narration`: diary of the change (migration story, roadmap/ticket
 *   breadcrumbs, cross-ref pointers, rejected-alternative inflation).
 * - `self-praise`: virtue claims / X-not-Y framing.
 * - `docstring-scope`: documents callers/callees/impl, or uses prose where a
 *   type belongs.
 * - `section-divider`: title-case banners and rule lines. Lowest confidence.
 * - `voice`: carries a real, load-bearing fact but in AI voice. The rewrite case.
 */
export const SLOP_CATEGORIES = [
  "restate-the-what",
  "narration",
  "self-praise",
  "docstring-scope",
  "section-divider",
  "voice",
] as const;

export type SlopCategory = (typeof SLOP_CATEGORIES)[number];

/**
 * What the applier does with a comment.
 *
 * - `keep`: it earns its place and is cleanly written. Leave it.
 * - `trim`: it carries no fact a competent reader lacks. Delete it, or trim to
 *   the worthwhile lines via `trimToLines`.
 * - `rewrite`: it carries a real fact under AI voice. Strip the voice, keep the
 *   fact. `rewrite` holds the de-voiced comment text.
 */
export const VERDICT_ACTIONS = ["keep", "trim", "rewrite"] as const;

export type VerdictAction = (typeof VERDICT_ACTIONS)[number];

export type Confidence = "low" | "medium" | "high";

export interface Verdict {
  action: VerdictAction;
  /** The slop category for `trim`/`rewrite`, `null` for `keep`. */
  category: SlopCategory | null;
  confidence: Confidence;
  /** One sentence: the fact the comment does or does not carry, and the voice stripped if rewriting. */
  rationale: string;
  /**
   * For `action: "rewrite"`: the de-voiced comment text, including its
   * delimiters. `null` for `keep` and `trim`.
   */
  rewrite: string | null;
  /** Present only with `--fix`: a concrete rewrite, trim, or delete suggestion. */
  suggestedFix?: string;
  /**
   * For a mixed block where only some lines are slop: the lines worth keeping,
   * numbered 1-based and relative to the comment (line 1 is the comment's first
   * line). Empty means delete the whole comment. Omitted when the comment is
   * judged as a single unit.
   */
  trimToLines?: number[];
}

/**
 * JSON Schema for one comment's verdict, for the Anthropic structured-output
 * config. `anyOf` (not `type: [...]`) per the structured-outputs schema subset.
 */
export function verdictSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      action: { type: "string", enum: [...VERDICT_ACTIONS] },
      category: {
        anyOf: [{ type: "string", enum: [...SLOP_CATEGORIES] }, { type: "null" }],
      },
      confidence: { type: "string", enum: ["low", "medium", "high"] },
      rationale: { type: "string" },
      rewrite: { anyOf: [{ type: "string" }, { type: "null" }] },
      suggestedFix: { anyOf: [{ type: "string" }, { type: "null" }] },
      trimToLines: {
        anyOf: [{ type: "array", items: { type: "integer" } }, { type: "null" }],
      },
    },
    required: ["action", "confidence", "rationale"],
    additionalProperties: false,
  };
}

/**
 * Batch schema: the judge scores N comments per call, returning verdicts by the
 * 0-based index it was given, so a dropped or reordered entry is detectable.
 * Used by the calibration oracle, which renders an indexed batch.
 */
export function batchVerdictSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      verdicts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: { type: "integer" },
            verdict: verdictSchema(),
          },
          required: ["index", "verdict"],
          additionalProperties: false,
        },
      },
    },
    required: ["verdicts"],
    additionalProperties: false,
  };
}

