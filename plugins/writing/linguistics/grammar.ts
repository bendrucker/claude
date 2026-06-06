import type { CoarseTag, TaggedToken } from "./tags";

/** Tags that can head or stand in for a subject noun phrase. */
const SUBJECT_TAGS = new Set<CoarseTag>(["NOUN", "PROPN", "PRON", "CODE", "GERUND", "NUM"]);

/** Tags that can modify a noun inside an NP. */
const NP_MODIFIER_TAGS = new Set<CoarseTag>([
  "DET",
  "ADJ",
  "ADV",
  "GERUND",
  "PARTICIPLE",
  "NOUN",
  "PROPN",
  "CODE",
  "NUM",
]);

/** Tags that can close an NP (its head). */
const NP_HEAD_TAGS = new Set<CoarseTag>(["NOUN", "PROPN", "CODE", "GERUND", "NUM"]);

/**
 * Attributive participle mis-tagged as a tensed verb: "a leaked key",
 * "the documented limits". A past-tense reading between a determiner or
 * adjective and the rest of a noun phrase is NP-internal, not a
 * predicate. ADJ is accepted on the right because taggers sometimes
 * call the head noun an adjective ("a leaked key" with "key" as ADJ).
 */
function isAttributive(tokens: TaggedToken[], index: number): boolean {
  const prev = tokens[index - 1];
  const next = tokens[index + 1];
  if (!prev || !next) return false;
  return (
    (prev.tag === "DET" || prev.tag === "ADJ") &&
    (next.tag === "NOUN" || next.tag === "PROPN" || next.tag === "CODE" || next.tag === "ADJ")
  );
}

/**
 * The positional rule from issue #745: a finite verb is clause evidence
 * only when a subject candidate precedes it and the verb is not the
 * entire heading. Single-token inputs never flag.
 */
export function finiteVerbWithSubject(tokens: TaggedToken[]): { index: number } | null {
  if (tokens.length <= 1) return null;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token?.finite) continue;
    if (token.tag !== "VERB" && token.tag !== "COPULA" && token.tag !== "AUX") continue;
    if (token.tag === "VERB" && isAttributive(tokens, i)) continue;
    if (tokens.slice(0, i).some((prior) => SUBJECT_TAGS.has(prior.tag))) {
      return { index: i };
    }
  }

  return null;
}

function parseNounPhrase(tokens: TaggedToken[], start: number): number {
  let i = start;
  let sawHead = false;
  while (i < tokens.length) {
    const token = tokens[i];
    if (!token) break;
    if (NP_MODIFIER_TAGS.has(token.tag) || (token.tag === "VERB" && isAttributive(tokens, i))) {
      if (NP_HEAD_TAGS.has(token.tag)) sawHead = true;
      i++;
      continue;
    }
    break;
  }
  return sawHead ? i : start;
}

/**
 * Does the whole token sequence parse as a noun phrase? Accepts an NP
 * core with prepositional attachments, coordination, and list
 * punctuation: "Blast Radius of a Leaked Key", "Schemas, Topics, and
 * Consumers". Any finite verb or unattached token fails the parse.
 */
export function isNounPhrase(tokens: TaggedToken[]): boolean {
  if (tokens.length === 0) return false;

  let i = parseNounPhrase(tokens, 0);
  if (i === 0) return false;

  while (i < tokens.length) {
    const token = tokens[i];
    if (!token) return false;

    if (token.tag === "PUNCT") {
      i++;
      continue;
    }

    if (token.tag === "ADP" || token.tag === "CONJ" || token.tag === "PART") {
      const next = parseNounPhrase(tokens, i + 1);
      if (next === i + 1) return false;
      i = next;
      continue;
    }

    // A bare NP can follow list punctuation: "Schemas, Topics, and Consumers".
    const next = parseNounPhrase(tokens, i);
    if (next > i) {
      i = next;
      continue;
    }

    return false;
  }

  return true;
}
