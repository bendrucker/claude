/**
 * Candidate heading classifiers for the corpus evaluation. This module
 * imports the tagger adapters, including `natural` (a devDependency the
 * plugin cache omits), so only eval tooling may import it, never hooks.
 */
import { compromiseTagger } from "./compromise";
import { finiteVerbWithSubject, isNounPhrase } from "./grammar";
import {
  baselineClassifier,
  ENUMERATOR_STOPLIST,
  type HeadingClassifier,
  type HeadingVerdict,
  INTERROGATIVE_OPENERS,
} from "./heading";
import { naturalTagger } from "./natural";
import { preprocessHeading } from "./preprocess";
import type { Tagger } from "./tagger";
import type { CoarseTag, TaggedToken } from "./tags";

const NOUN_PHRASE: HeadingVerdict = { kind: "noun-phrase", flagged: false, evidence: [] };

// A non-finite verb opener followed by a function word or modifier reads
// imperative ("Build Against...", "Run the..."); a following noun is
// more likely a compound ("Test Coverage Strategy").
const IMPERATIVE_SECOND = new Set<CoarseTag>(["DET", "ADP", "PRON", "ADJ", "ADV"]);

interface TaggedHeading {
  tokens: TaggedToken[];
  enumerator: boolean;
}

function tagHeading(tagger: Tagger, heading: string): TaggedHeading {
  const { text, enumerator } = preprocessHeading(heading);
  if (text.length === 0) return { tokens: [], enumerator };
  return { tokens: tagger.tag(text).flatMap((sentence) => sentence.tokens), enumerator };
}

function interrogative(tokens: TaggedToken[]): HeadingVerdict | null {
  const first = tokens[0];
  if (first && INTERROGATIVE_OPENERS.has(first.normal)) {
    return { kind: "interrogative", flagged: false, evidence: ["interrogative opener"] };
  }
  return null;
}

function clauseVerdict(tokens: TaggedToken[], index: number): HeadingVerdict {
  const verb = tokens[index];
  return {
    kind: "clause",
    flagged: true,
    evidence: [`finite ${verb?.tag.toLowerCase()} "${verb?.text}"`],
  };
}

/**
 * Flag only when a finite verb follows a subject candidate. Misses
 * imperatives by design.
 */
export function finiteVerbClassifier(tagger: Tagger): HeadingClassifier {
  return {
    name: `finite-verb:${tagger.name}`,
    classify(heading) {
      const { tokens } = tagHeading(tagger, heading);
      if (tokens.length === 0) return NOUN_PHRASE;
      const exempt = interrogative(tokens);
      if (exempt) return exempt;
      const finite = finiteVerbWithSubject(tokens);
      if (finite) return clauseVerdict(tokens, finite.index);
      return NOUN_PHRASE;
    },
  };
}

/**
 * The issue's NP test: a heading should parse as a noun phrase. Flags
 * when the parse fails AND there is corroborating verb evidence, so
 * tagger noise on jargon does not flag verb-less fragments.
 */
export function npTestClassifier(tagger: Tagger): HeadingClassifier {
  return {
    name: `np-test:${tagger.name}`,
    classify(heading) {
      const { tokens, enumerator } = tagHeading(tagger, heading);
      if (tokens.length === 0) return NOUN_PHRASE;
      const exempt = interrogative(tokens);
      if (exempt) return exempt;

      const finite = finiteVerbWithSubject(tokens);
      if (finite) return clauseVerdict(tokens, finite.index);

      if (isNounPhrase(tokens)) return NOUN_PHRASE;

      const [first, second] = tokens;
      const opensWithVerb = first?.tag === "VERB" && !first.finite;

      if (
        opensWithVerb &&
        !enumerator &&
        tokens.length >= 3 &&
        second &&
        IMPERATIVE_SECOND.has(second.tag)
      ) {
        return {
          kind: "imperative",
          flagged: true,
          evidence: [`imperative opener "${first.text}"`],
        };
      }

      // A verb-tagged opener followed by a noun is usually a compound
      // ("Blast Radius", "Test Coverage Strategy"): retry the NP parse
      // with the opener read as a noun.
      if (opensWithVerb) {
        const coerced = tokens.map((token, index) =>
          index === 0 ? { ...token, tag: "NOUN" as const } : token,
        );
        if (isNounPhrase(coerced)) return NOUN_PHRASE;
      }

      const verb = tokens.find(
        (token) => token.tag === "VERB" || token.tag === "COPULA" || token.tag === "AUX",
      );
      if (verb && tokens.length >= 3 && !enumerator) {
        return {
          kind: opensWithVerb ? "imperative" : "clause",
          flagged: true,
          evidence: [`not an NP; ${verb.tag.toLowerCase()} "${verb.text}"`],
        };
      }

      return { kind: "fragment", flagged: false, evidence: ["not an NP; no finite verb"] };
    },
  };
}

/**
 * The baseline's structure with its hand-maintained verb sets replaced
 * by tagger judgments: finite-verb-with-subject instead of
 * LINKING_VERBS, and verb-plus-determiner/preposition opener instead of
 * IMPERATIVE_OPENERS.
 */
export function hybridClassifier(tagger: Tagger): HeadingClassifier {
  return {
    name: `hybrid:${tagger.name}`,
    classify(heading) {
      const { text, enumerator } = preprocessHeading(heading);
      if (text.length === 0) return NOUN_PHRASE;
      const tokens = tagger.tag(text).flatMap((sentence) => sentence.tokens);
      if (tokens.length === 0) return NOUN_PHRASE;
      const exempt = interrogative(tokens);
      if (exempt) return exempt;

      // Colon rule operates on the text: taggers strip or split the
      // colon, so token positions cannot locate it.
      const colonIndex = text.indexOf(":");
      if (colonIndex !== -1) {
        const before = text
          .slice(0, colonIndex)
          .trim()
          .split(/\s+/)
          .filter((word) => word.length > 0);
        const afterText = text.slice(colonIndex + 1).trim();
        const after = afterText.split(/\s+/).filter((word) => word.length > 0);
        const afterTokens = tagger.tag(afterText).flatMap((sentence) => sentence.tokens);
        const predicate = afterTokens.some(
          (token) => (token.finite && token.tag !== "AUX") || token.normal === "not",
        );
        const preEnumerator = before[0] ? ENUMERATOR_STOPLIST.test(before[0]) : false;
        if (before.length <= 4 && after.length >= 3 && predicate && !preEnumerator) {
          return { kind: "clause", flagged: true, evidence: ["colon-gated predicate"] };
        }
      }

      const finite = finiteVerbWithSubject(tokens);
      if (finite) return clauseVerdict(tokens, finite.index);

      if (
        tokens.length >= 4 &&
        tokens.some((token) => ["that", "which", "who"].includes(token.normal))
      ) {
        return { kind: "clause", flagged: true, evidence: ["relative clause"] };
      }

      const [first, second] = tokens;
      if (
        !enumerator &&
        tokens.length >= 3 &&
        first?.tag === "VERB" &&
        !first.finite &&
        second &&
        IMPERATIVE_SECOND.has(second.tag)
      ) {
        return {
          kind: "imperative",
          flagged: true,
          evidence: [`imperative opener "${first.text}"`],
        };
      }

      return NOUN_PHRASE;
    },
  };
}

const TAGGERS: Tagger[] = [compromiseTagger, naturalTagger];

export const CLASSIFIERS: HeadingClassifier[] = [
  baselineClassifier,
  ...TAGGERS.flatMap((tagger) => [
    finiteVerbClassifier(tagger),
    npTestClassifier(tagger),
    hybridClassifier(tagger),
  ]),
];
