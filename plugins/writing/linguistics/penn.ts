import { type CoarseTag, COPULA_FORMS } from "./tags";

export interface PennMapping {
  tag: CoarseTag;
  finite: boolean;
}

/**
 * Map a Penn Treebank tag to the coarse tag space. `normal` (the
 * lowercased surface form) disambiguates copulas, which Penn folds
 * into the ordinary verb tags.
 */
export function mapPenn(pos: string, normal: string): PennMapping {
  switch (pos) {
    case "NN":
    case "NNS":
      return { tag: "NOUN", finite: false };
    case "NNP":
    case "NNPS":
      return { tag: "PROPN", finite: false };
    case "PRP":
    case "PRP$":
    case "WP":
    case "WP$":
    case "EX":
      return { tag: "PRON", finite: false };
    case "VBZ":
    case "VBP":
    case "VBD":
      return { tag: COPULA_FORMS.has(normal) ? "COPULA" : "VERB", finite: true };
    case "VB":
      return { tag: COPULA_FORMS.has(normal) ? "COPULA" : "VERB", finite: false };
    case "VBG":
      return { tag: "GERUND", finite: false };
    case "VBN":
      return { tag: "PARTICIPLE", finite: false };
    case "MD":
      return { tag: "AUX", finite: true };
    case "JJ":
    case "JJR":
    case "JJS":
      return { tag: "ADJ", finite: false };
    case "RB":
    case "RBR":
    case "RBS":
    case "WRB":
      return { tag: "ADV", finite: false };
    case "DT":
    case "PDT":
    case "WDT":
      return { tag: "DET", finite: false };
    case "IN":
      return { tag: "ADP", finite: false };
    case "CC":
      return { tag: "CONJ", finite: false };
    case "CD":
      return { tag: "NUM", finite: false };
    case "TO":
    case "RP":
    case "POS":
      return { tag: "PART", finite: false };
    default:
      if (/^[A-Z]/.test(pos)) return { tag: "X", finite: false };
      return { tag: "PUNCT", finite: false };
  }
}
