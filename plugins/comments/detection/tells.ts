/**
 * High-precision deterministic tells over a single comment. These are an
 * advisory signal surfaced alongside the LLM judge, never a gate or a
 * replacement for it. Each pattern is corpus-validated and tuned to err toward
 * precision (few false positives) over recall.
 */

import type { Comment } from "./types";

export type TellId = "roadmap-breadcrumb" | "line-number-crossref" | "section-banner";

export interface Tell {
  id: TellId;
  reason: string;
}

/**
 * Tracker tags: the known `ENG-<n>` prefix, plus a generic uppercase form. The
 * 2+ digit requirement keeps out encodings like `UTF-8`.
 */
const TRACKER_RE = /\bENG-\d+\b|\b[A-Z]{2,5}-\d{2,}\b/g;

/**
 * Generic uppercase tags that read as protocols, encodings, or standards rather
 * than tracker references (e.g. `HTTP-200`, `SHA-256`). Excluded so the generic
 * form only counts when it clearly reads as a tracker.
 */
const NON_TRACKER_PREFIXES = new Set([
  "HTTP",
  "HTTPS",
  "RFC",
  "ISO",
  "SHA",
  "UTF",
  "ASCII",
  "UTC",
  "GMT",
  "AES",
]);

const LINE_CROSSREF_RE = /\bat line \d+\b/i;

const BANNER_RULE_RE = /^[-=*#~]{3,}$/;
const BANNER_LABEL_RE = /^([A-Z][A-Za-z0-9]*)(\s+[A-Z][A-Za-z0-9]*){0,4}$/;

function hasTrackerReference(text: string): boolean {
  for (const match of text.matchAll(TRACKER_RE)) {
    const tag = match[0];
    const prefix = tag.slice(0, tag.indexOf("-"));
    if (!NON_TRACKER_PREFIXES.has(prefix)) {
      return true;
    }
  }
  return false;
}

function bannerBody(text: string): string {
  return text.replace(/^\s*(\/\/|#)/, "").trim();
}

function isSectionBanner(comment: Comment): boolean {
  if (comment.kind !== "line") {
    return false;
  }
  const body = bannerBody(comment.text);
  return BANNER_RULE_RE.test(body) || BANNER_LABEL_RE.test(body);
}

export function detectTells(comment: Comment): Tell[] {
  const tells: Tell[] = [];

  if (hasTrackerReference(comment.text)) {
    tells.push({
      id: "roadmap-breadcrumb",
      reason: "references a project-tracker ticket baked into the code",
    });
  }

  if (LINE_CROSSREF_RE.test(comment.text)) {
    tells.push({
      id: "line-number-crossref",
      reason: "points at a hardcoded source line that drifts as code moves",
    });
  }

  if (isSectionBanner(comment)) {
    tells.push({
      id: "section-banner",
      reason: "organizes code visually instead of adding information",
    });
  }

  return tells;
}
