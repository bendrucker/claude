import nlp from "compromise";
import {
  CODE_SENTINEL,
  type CoarseTag,
  COPULA_FORMS,
  FINITE_COPULAS,
  type TaggedSentence,
  type TaggedToken,
} from "./tags";
import type { Tagger } from "./tagger";

interface CompromiseTerm {
  text: string;
  normal?: string;
  tags?: string[];
}

interface CompromiseSentence {
  text: string;
  terms: CompromiseTerm[];
}

function mapTerm(term: CompromiseTerm): Pick<TaggedToken, "tag" | "finite"> {
  const tags = new Set(term.tags ?? []);
  const normal = (term.normal ?? term.text).toLowerCase();

  if (normal === CODE_SENTINEL) return { tag: "CODE", finite: false };

  // Copulas are a closed class checked by surface form: Title Case input
  // tags `Is` as a proper noun and hides the Copula tag.
  if (tags.has("Copula") || COPULA_FORMS.has(normal)) {
    return { tag: "COPULA", finite: FINITE_COPULAS.has(normal) };
  }

  if (tags.has("Gerund")) return { tag: "GERUND", finite: false };
  if (tags.has("Participle") || (tags.has("PastTense") && tags.has("Passive"))) {
    return { tag: "PARTICIPLE", finite: false };
  }
  if (tags.has("Modal")) return { tag: "AUX", finite: true };
  if (tags.has("Auxiliary")) return { tag: "AUX", finite: !tags.has("Infinitive") };
  if (tags.has("Verb")) {
    if (tags.has("Infinitive")) return { tag: "VERB", finite: false };
    return { tag: "VERB", finite: tags.has("PresentTense") || tags.has("PastTense") };
  }

  if (tags.has("Value") || tags.has("Cardinal") || tags.has("Ordinal")) {
    return { tag: "NUM", finite: false };
  }
  if (tags.has("Pronoun") || tags.has("QuestionWord")) return { tag: "PRON", finite: false };
  if (tags.has("ProperNoun")) return { tag: "PROPN", finite: false };
  if (tags.has("Noun")) return { tag: "NOUN", finite: false };
  if (tags.has("Adjective")) return { tag: "ADJ", finite: false };
  if (tags.has("Adverb")) return { tag: "ADV", finite: false };
  if (tags.has("Determiner")) return { tag: "DET", finite: false };
  if (tags.has("Preposition")) return { tag: "ADP", finite: false };
  if (tags.has("Conjunction")) return { tag: "CONJ", finite: false };
  if (tags.has("Negative")) return { tag: "PART", finite: false };

  const tag: CoarseTag = /^[^\w\s]+$/.test(term.text) ? "PUNCT" : "X";
  return { tag, finite: false };
}

export const compromiseTagger: Tagger = {
  name: "compromise",
  tag(text: string): TaggedSentence[] {
    const sentences = nlp(text).json() as CompromiseSentence[];
    return sentences.map((sentence) => ({
      text: sentence.text,
      tokens: sentence.terms.map((term) => ({
        text: term.text,
        normal: (term.normal ?? term.text).toLowerCase(),
        fine: term.tags ?? [],
        ...mapTerm(term),
      })),
    }));
  },
};
