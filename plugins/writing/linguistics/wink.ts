import winkPOS from "wink-pos-tagger";
import { mapPenn } from "./penn";
import { CODE_SENTINEL, type TaggedSentence } from "./tags";
import type { Tagger } from "./tagger";

const tagger = winkPOS();

export const winkTagger: Tagger = {
  name: "wink",
  tag(text: string): TaggedSentence[] {
    const tokens = tagger.tagSentence(text).map((token) => {
      const normal = token.normal.toLowerCase();
      const mapped =
        normal === CODE_SENTINEL
          ? { tag: "CODE" as const, finite: false }
          : mapPenn(token.pos, token.lemma === "be" ? "be" : normal);
      return {
        text: token.value,
        normal,
        fine: [token.pos],
        ...mapped,
      };
    });
    return [{ text, tokens }];
  },
};
