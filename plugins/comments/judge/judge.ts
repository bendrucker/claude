import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  type Confidence,
  type SlopCategory,
  VERDICT_ACTIONS,
  type Verdict,
  type VerdictAction,
} from "./schema";

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

/**
 * Validates one verdict object's shape, returning a typed `Verdict`. `label`
 * identifies the entry in error messages (a comment id on the apply path, or a
 * batch index in the oracle). Shared so the agent fan-out and the oracle reject
 * malformed verdicts identically.
 */
export function parseVerdict(value: unknown, label: string | number): Verdict {
  if (typeof value !== "object" || value === null) {
    throw new Error(`Judge verdict ${label} must be an object`);
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.action !== "string" ||
    !VERDICT_ACTIONS.includes(record.action as VerdictAction)
  ) {
    throw new Error(`Judge verdict ${label} "action" must be one of ${VERDICT_ACTIONS.join(", ")}`);
  }
  const action = record.action as VerdictAction;
  if (record.category != null && typeof record.category !== "string") {
    throw new Error(`Judge verdict ${label} "category" must be a string or null`);
  }
  if (typeof record.confidence !== "string") {
    throw new Error(`Judge verdict ${label} "confidence" must be a string`);
  }
  if (typeof record.rationale !== "string") {
    throw new Error(`Judge verdict ${label} "rationale" must be a string`);
  }
  const hasRewrite = typeof record.rewrite === "string" && record.rewrite.length > 0;
  if (action === "rewrite" && !hasRewrite) {
    throw new Error(
      `Judge verdict ${label} "rewrite" must be a non-empty string when action is "rewrite"`,
    );
  }
  if (action !== "rewrite" && hasRewrite) {
    throw new Error(`Judge verdict ${label} "rewrite" is only valid when action is "rewrite"`);
  }
  const verdict: Verdict = {
    action,
    category: (record.category ?? null) as SlopCategory | null,
    confidence: record.confidence as Confidence,
    rationale: record.rationale,
    rewrite: action === "rewrite" ? (record.rewrite as string) : null,
  };
  if (typeof record.suggestedFix === "string") verdict.suggestedFix = record.suggestedFix;
  if (Array.isArray(record.trimToLines)) {
    verdict.trimToLines = record.trimToLines.filter(
      (line): line is number => typeof line === "number",
    );
  }
  return verdict;
}
