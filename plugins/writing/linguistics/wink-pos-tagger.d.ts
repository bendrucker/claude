declare module "wink-pos-tagger" {
  export interface WinkToken {
    value: string;
    tag: "word" | "punctuation" | "number" | "email" | "url" | "mention" | "hashtag" | "symbol";
    normal: string;
    pos: string;
    lemma?: string;
  }

  export interface WinkTagger {
    tagSentence(sentence: string): WinkToken[];
    tag(tokens: string[]): WinkToken[];
    updateLexicon(lexicon: Record<string, string[]>): void;
  }

  export default function winkPOS(): WinkTagger;
}
