import { createHash } from "node:crypto";
import { join } from "node:path";
import type { SlopCategory, Verdict } from "./schema";

/**
 * Shared judge primitives: the versioned prompt and per-verdict validation. The
 * product path shards comments in `job.ts` for the agent fan-out to judge, and
 * `apply/join.ts` validates the verdicts that come back. The calibration oracle
 * under `evals/` scores a fixed corpus. The prompt is a committed, versioned
 * artifact, and every run records its sha256, so a prompt edit invalidates prior
 * numbers.
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

/** Comments judged per shard on the product path, and per batch in the oracle. */
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
  if (typeof record.isSlop !== "boolean") {
    throw new Error(`Judge verdict ${label} "isSlop" must be a boolean`);
  }
  if (record.category !== null && typeof record.category !== "string") {
    throw new Error(`Judge verdict ${label} "category" must be a string or null`);
  }
  if (typeof record.confidence !== "string") {
    throw new Error(`Judge verdict ${label} "confidence" must be a string`);
  }
  if (typeof record.rationale !== "string") {
    throw new Error(`Judge verdict ${label} "rationale" must be a string`);
  }
  const verdict: Verdict = {
    isSlop: record.isSlop,
    category: record.category as SlopCategory | null,
    confidence: record.confidence as Verdict["confidence"],
    rationale: record.rationale,
  };
  if (typeof record.suggestedFix === "string") verdict.suggestedFix = record.suggestedFix;
  if (Array.isArray(record.trimToLines)) {
    verdict.trimToLines = record.trimToLines.filter(
      (line): line is number => typeof line === "number",
    );
  }
  return verdict;
}
