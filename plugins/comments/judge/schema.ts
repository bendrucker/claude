/**
 * The judge verdict contract. One verdict per introduced comment. The taxonomy
 * is the corpus-validated v1 set. The judge must never flag the two justified
 * comment types (what-on-dense, why-on-simple) or genuine design rationale.
 */

/**
 * Slop categories, in descending corpus frequency. `null` category accompanies
 * `isSlop: false`.
 *
 * - `restate-the-what`: paraphrases simple adjacent code, adds no reason.
 * - `narration`: diary of the change (migration story, roadmap/ticket
 *   breadcrumbs, cross-ref pointers, rejected-alternative inflation).
 * - `self-praise`: virtue claims / X-not-Y framing.
 * - `docstring-scope`: documents callers/callees/impl, or uses prose where a
 *   type belongs.
 * - `section-divider`: title-case banners and rule lines. Lowest confidence.
 */
export const SLOP_CATEGORIES = [
  "restate-the-what",
  "narration",
  "self-praise",
  "docstring-scope",
  "section-divider",
] as const;

export type SlopCategory = (typeof SLOP_CATEGORIES)[number];

export type Confidence = "low" | "medium" | "high";

export interface Verdict {
  isSlop: boolean;
  /** The slop category when `isSlop`, else `null`. */
  category: SlopCategory | null;
  confidence: Confidence;
  /** One sentence: why this is or is not slop, in the owner's two-type model. */
  rationale: string;
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
      isSlop: { type: "boolean" },
      category: {
        anyOf: [{ type: "string", enum: [...SLOP_CATEGORIES] }, { type: "null" }],
      },
      confidence: { type: "string", enum: ["low", "medium", "high"] },
      rationale: { type: "string" },
      suggestedFix: { anyOf: [{ type: "string" }, { type: "null" }] },
      trimToLines: {
        anyOf: [{ type: "array", items: { type: "integer" } }, { type: "null" }],
      },
    },
    required: ["isSlop", "category", "confidence", "rationale"],
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

/**
 * Batch schema keyed by the stable comment id rather than a positional index.
 * The agent fan-out reads a shard of id-tagged comments and returns one verdict
 * per id, so the applier can id-join verdicts back to recorded ranges.
 */
export function batchVerdictKeyedSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      verdicts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            verdict: verdictSchema(),
          },
          required: ["id", "verdict"],
          additionalProperties: false,
        },
      },
    },
    required: ["verdicts"],
    additionalProperties: false,
  };
}
