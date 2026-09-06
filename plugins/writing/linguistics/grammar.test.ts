import { describe, expect, it } from "bun:test";
import { finiteVerbWithSubject, isNounPhrase } from "./grammar";
import type { CoarseTag, TaggedToken } from "./tags";

function tok(text: string, tag: CoarseTag, finite = false): TaggedToken {
  return { text, normal: text.toLowerCase(), tag, finite, fine: [] };
}

describe("finiteVerbWithSubject", () => {
  it("finds a finite copula after a subject", () => {
    const tokens = [
      tok("latency", "NOUN"),
      tok("is", "COPULA", true),
      tok("the", "DET"),
      tok("bottleneck", "NOUN"),
    ];
    expect(finiteVerbWithSubject(tokens)).toEqual({ index: 1 });
  });

  it("finds a finite verb after a subject", () => {
    const tokens = [tok("proxy", "NOUN"), tok("holds", "VERB", true), tok("tokens", "NOUN")];
    expect(finiteVerbWithSubject(tokens)).toEqual({ index: 1 });
  });

  it("requires a subject before the verb", () => {
    const tokens = [tok("supports", "VERB", true), tok("the", "DET"), tok("edge", "NOUN")];
    expect(finiteVerbWithSubject(tokens)).toBeNull();
  });

  it("never flags a single token", () => {
    expect(finiteVerbWithSubject([tok("changes", "VERB", true)])).toBeNull();
  });

  it("skips attributive participles inside an NP", () => {
    const tokens = [
      tok("radius", "NOUN"),
      tok("of", "ADP"),
      tok("a", "DET"),
      tok("leaked", "VERB", true),
      tok("key", "NOUN"),
    ];
    expect(finiteVerbWithSubject(tokens)).toBeNull();
  });

  it("skips attributive participles when the head mis-tags as ADJ", () => {
    const tokens = [
      tok("a", "DET"),
      tok("leaked", "VERB", true),
      tok("key", "ADJ"),
      tok("rotation", "NOUN"),
    ];
    expect(finiteVerbWithSubject(tokens)).toBeNull();
  });

  it("does not skip a predicate verb after a determiner phrase", () => {
    const tokens = [
      tok("the", "DET"),
      tok("cache", "NOUN"),
      tok("holds", "VERB", true),
      tok("entries", "NOUN"),
    ];
    expect(finiteVerbWithSubject(tokens)).toEqual({ index: 2 });
  });

  it("ignores non-finite verbs", () => {
    const tokens = [tok("cache", "NOUN"), tok("warming", "GERUND"), tok("strategy", "NOUN")];
    expect(finiteVerbWithSubject(tokens)).toBeNull();
  });
});

describe("isNounPhrase", () => {
  const cases: { description: string; tokens: TaggedToken[]; want: boolean }[] = [
    {
      description: "simple compound",
      tokens: [tok("cache", "NOUN"), tok("layer", "NOUN")],
      want: true,
    },
    {
      description: "NP with prepositional attachment",
      tokens: [
        tok("blast", "NOUN"),
        tok("radius", "NOUN"),
        tok("of", "ADP"),
        tok("a", "DET"),
        tok("leaked", "PARTICIPLE"),
        tok("key", "NOUN"),
      ],
      want: true,
    },
    {
      description: "attributive verb mis-tag inside a PP",
      tokens: [
        tok("radius", "NOUN"),
        tok("of", "ADP"),
        tok("a", "DET"),
        tok("leaked", "VERB", true),
        tok("key", "NOUN"),
      ],
      want: true,
    },
    {
      description: "coordinated list with punctuation",
      tokens: [
        tok("schemas", "NOUN"),
        tok(",", "PUNCT"),
        tok("topics", "NOUN"),
        tok(",", "PUNCT"),
        tok("and", "CONJ"),
        tok("consumers", "NOUN"),
      ],
      want: true,
    },
    {
      description: "gerund-headed label",
      tokens: [tok("testing", "GERUND"), tok("strategy", "NOUN")],
      want: true,
    },
    {
      description: "code sentinel as head",
      tokens: [tok("the", "DET"), tok("codeterm", "CODE"), tok("hook", "NOUN")],
      want: true,
    },
    {
      description: "clause with finite copula",
      tokens: [
        tok("latency", "NOUN"),
        tok("is", "COPULA", true),
        tok("the", "DET"),
        tok("bottleneck", "NOUN"),
      ],
      want: false,
    },
    {
      description: "imperative opener",
      tokens: [
        tok("build", "VERB"),
        tok("against", "ADP"),
        tok("the", "DET"),
        tok("limits", "NOUN"),
      ],
      want: false,
    },
    {
      description: "determiner without a head",
      tokens: [tok("the", "DET"), tok("very", "ADV")],
      want: false,
    },
    {
      description: "empty input",
      tokens: [],
      want: false,
    },
  ];

  it.each(cases)("$description", ({ tokens, want }) => {
    expect(isNounPhrase(tokens)).toBe(want);
  });
});
