/**
 * Coarse part-of-speech tag set, modeled on Universal POS tags with
 * additions the heading grammar needs (COPULA, GERUND, PARTICIPLE, CODE).
 * Every tagger adapter maps its native tags into this space so the
 * grammar rules are tagger-neutral.
 */
export type CoarseTag =
  | "NOUN"
  | "PROPN"
  | "PRON"
  | "VERB"
  | "AUX"
  | "COPULA"
  | "GERUND"
  | "PARTICIPLE"
  | "ADJ"
  | "ADV"
  | "DET"
  | "ADP"
  | "CONJ"
  | "NUM"
  | "PART"
  | "PUNCT"
  | "CODE"
  | "X";

export interface TaggedToken {
  /** Surface form, post-preprocessing. */
  text: string;
  /** Lowercased/normalized form. */
  normal: string;
  tag: CoarseTag;
  /**
   * True for tensed verb forms (VBZ/VBD/VBP, finite copulas, modals).
   * A finite verb is the unambiguous clause signal; infinitives,
   * gerunds, and participles are not.
   */
  finite: boolean;
  /** Native tagger tags, for evidence strings and debugging. */
  fine: string[];
}

export interface TaggedSentence {
  text: string;
  tokens: TaggedToken[];
}

/**
 * Replacement token for code identifiers (paths, camelCase, snake_case,
 * inline code). A plain lowercase word so every tokenizer passes it
 * through intact and tags it noun-like; adapters map it to CODE by
 * matching the normal form.
 */
export const CODE_SENTINEL = "codeterm";

/**
 * Finite copula forms. A closed grammatical class checked by surface
 * form, so Title Case mis-tagging (`Is` as ProperNoun) cannot hide a
 * copula from the grammar.
 */
export const FINITE_COPULAS = new Set(["is", "am", "are", "was", "were", "'s", "'re", "'m"]);

/** All copula forms, finite and non-finite. */
export const COPULA_FORMS = new Set([...FINITE_COPULAS, "be", "been", "being"]);
