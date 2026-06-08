import type { TaggedSentence } from "./tags";

export interface Tagger {
  name: string;
  /**
   * Sentence-split and tag. An adapter without sentence detection may
   * treat the whole input as one sentence, which is correct for
   * heading-sized inputs.
   */
  tag(text: string): TaggedSentence[];
}
