import { createHash } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { SLOP_CATEGORIES, VERDICT_ACTIONS, type Verdict } from "./schema";

/**
 * Shared judge primitives: the versioned prompt and per-verdict validation, used
 * by both the agent fan-out and the eval oracle. The prompt is a committed,
 * versioned artifact, and every run records its sha256, so a prompt edit
 * invalidates prior numbers.
 */

export const PROMPT_PATH = join(import.meta.dirname, "prompt.md");

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export interface VersionedPrompt {
  text: string;
  sha256: string;
}

export async function loadPrompt(promptPath: string = PROMPT_PATH): Promise<VersionedPrompt> {
  const text = await Bun.file(promptPath).text();
  return { text, sha256: sha256(text) };
}

/** Comments per shard in production, and per batch in the oracle. */
export const BATCH_SIZE = 20;

const TRIM_TO_ERROR = `"trimTo" must be a non-empty string`;

const VerdictInput = z
  .looseObject(
    {
      action: z.enum(VERDICT_ACTIONS, {
        error: `"action" must be one of ${VERDICT_ACTIONS.join(", ")}`,
      }),
      category: z
        .enum(SLOP_CATEGORIES, {
          error: `"category" must be one of ${SLOP_CATEGORIES.join(", ")} or null`,
        })
        .nullish(),
      confidence: z.enum(["low", "medium", "high"], {
        error: `"confidence" must be one of low, medium, high`,
      }),
      rationale: z.string({ error: `"rationale" must be a string` }),
      rewrite: z.string({ error: `"rewrite" must be a string` }).nullish(),
      suggestedFix: z.string({ error: `"suggestedFix" must be a string` }).nullish(),
      trimTo: z.string({ error: TRIM_TO_ERROR }).min(1, { error: TRIM_TO_ERROR }).nullish(),
      trimToLines: z.array(z.unknown(), { error: `"trimToLines" must be an array` }).nullish(),
    },
    { error: "must be an object" },
  )
  .superRefine((verdict, ctx) => {
    const rewritten = verdict.action === "rewrite";
    if (rewritten && !verdict.rewrite) {
      ctx.addIssue({
        code: "custom",
        message: `"rewrite" must be a non-empty string when action is "rewrite"`,
      });
    }
    if (!rewritten && verdict.rewrite) {
      ctx.addIssue({ code: "custom", message: `"rewrite" is only valid when action is "rewrite"` });
    }
    if (verdict.trimTo != null && verdict.action !== "trim") {
      ctx.addIssue({ code: "custom", message: `"trimTo" is only valid when action is "trim"` });
    }
  });

/**
 * Validates one verdict object's shape, returning a typed `Verdict`. `label`
 * identifies the entry in error messages (a comment id on the apply path, or a
 * batch index in the oracle). Shared so the agent fan-out and the oracle reject
 * malformed verdicts identically.
 */
export function parseVerdict(value: unknown, label: string | number): Verdict {
  const parsed = VerdictInput.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Judge verdict ${label} ${parsed.error.issues[0]?.message}`);
  }
  const decoded = parsed.data;

  const verdict: Verdict = {
    action: decoded.action,
    category: decoded.category ?? null,
    confidence: decoded.confidence,
    rationale: decoded.rationale,
    rewrite: decoded.action === "rewrite" ? (decoded.rewrite ?? null) : null,
  };
  if (decoded.suggestedFix != null) verdict.suggestedFix = decoded.suggestedFix;
  if (decoded.trimTo != null) verdict.trimTo = decoded.trimTo;
  if (decoded.trimToLines != null) {
    verdict.trimToLines = decoded.trimToLines.filter((line) => typeof line === "number");
  }
  return verdict;
}
