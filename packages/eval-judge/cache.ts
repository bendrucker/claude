import { createHash } from "node:crypto";

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Short hash of a judge prompt template, so verdicts from different prompts never pool. */
export function promptHash(template: string): string {
  return sha256(template).slice(0, 12);
}

/** Identifies one judge call by everything it depended on: prompt hash, model, options, and the texts judged. */
export function cacheKey(...parts: unknown[]): string {
  return sha256(JSON.stringify(parts)).slice(0, 16);
}

/** A cached verdict is reusable only when its recorded key matches the call about to be made. */
export function isFresh<T extends { key?: string | undefined }>(
  existing: T | undefined,
  key: string,
): existing is T {
  return existing?.key === key;
}
