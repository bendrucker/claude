import natural from "natural";
import { mapPenn } from "./penn";
import type { Tagger } from "./tagger";
import { CODE_SENTINEL, type TaggedSentence } from "./tags";

const lexicon = new natural.Lexicon("EN", "NN", "NNP");
const ruleSet = new natural.RuleSet("EN");
const brill = new natural.BrillPOSTagger(lexicon, ruleSet);
const tokenizer = new natural.WordTokenizer();

export const naturalTagger: Tagger = {
  name: "natural",
  tag(text: string): TaggedSentence[] {
    const words = tokenizer.tokenize(text);
    const tokens = brill.tag(words).taggedWords.map((tagged) => {
      const normal = tagged.token.toLowerCase();
      const mapped =
        normal === CODE_SENTINEL
          ? { tag: "CODE" as const, finite: false }
          : mapPenn(tagged.tag, normal);
      return {
        text: tagged.token,
        normal,
        fine: [tagged.tag],
        ...mapped,
      };
    });
    return [{ text, tokens }];
  },
};
