import { describe, expect, it } from "bun:test";
import { CLASSIFIERS, finiteVerbClassifier, hybridClassifier, npTestClassifier } from "./classifiers";
import { compromiseTagger } from "./compromise";
import { seedCases } from "./heading.test";

describe("CLASSIFIERS", () => {
  it("includes the baseline and three candidates per tagger", () => {
    expect(CLASSIFIERS.map((classifier) => classifier.name)).toEqual([
      "baseline",
      "finite-verb:compromise",
      "np-test:compromise",
      "hybrid:compromise",
      "finite-verb:wink",
      "np-test:wink",
      "hybrid:wink",
      "finite-verb:natural",
      "np-test:natural",
      "hybrid:natural",
    ]);
  });

  it("every classifier returns a verdict for every seed case", () => {
    for (const classifier of CLASSIFIERS) {
      for (const { heading } of seedCases) {
        const verdict = classifier.classify(heading);
        expect(typeof verdict.flagged).toBe("boolean");
        expect(verdict.kind).toBeDefined();
      }
    }
  });
});

// Documented behavior of the compromise-backed candidates on invented
// examples. These assertions record where each candidate stands today,
// including known misses; the corpus eval decides promotion.
const compromiseCases: Array<{
  description: string;
  heading: string;
  finiteVerb: boolean;
  npTest: boolean;
  hybrid: boolean;
}> = [
  {
    description: "finite copula in Title Case (baseline parity)",
    heading: "Latency Is the Main Bottleneck",
    finiteVerb: true,
    npTest: true,
    hybrid: true,
  },
  {
    description: "documented baseline miss: out-of-set verb after colon",
    heading: "Refresh: Now Supported at the Edge, Unconfirmed for the Client",
    finiteVerb: true,
    npTest: true,
    hybrid: true,
  },
  {
    description: "imperative with preposition (finite-verb misses by design)",
    heading: "Build Against the Documented Limits",
    finiteVerb: false,
    npTest: true,
    hybrid: true,
  },
  {
    description: "imperative with determiner (finite-verb misses by design)",
    heading: "Run the Migration Before Deploying",
    finiteVerb: false,
    npTest: true,
    hybrid: true,
  },
  {
    description: "coordinated imperative list (known hybrid miss)",
    heading: "Document, Stabilize, and Expose the Internal Cache API",
    finiteVerb: false,
    npTest: true,
    hybrid: false,
  },
  {
    description: "attributive participle stays quiet",
    heading: "Blast Radius of a Leaked Key",
    finiteVerb: false,
    npTest: false,
    hybrid: false,
  },
  {
    description: "verb-tagged opener in a compound noun stays quiet",
    heading: "Test Coverage Strategy",
    finiteVerb: false,
    npTest: false,
    hybrid: false,
  },
  {
    description: "two-word compound with verb-tagged opener stays quiet",
    heading: "Blast Radius",
    finiteVerb: false,
    npTest: false,
    hybrid: false,
  },
  {
    description: "two-word imperative below threshold stays quiet",
    heading: "Build Now",
    finiteVerb: false,
    npTest: false,
    hybrid: false,
  },
  {
    description: "enumerator-led imperative stays quiet",
    heading: "Step 1: Read the Transcript",
    finiteVerb: false,
    npTest: false,
    hybrid: false,
  },
  {
    description: "single-word verb-tagged heading stays quiet",
    heading: "Changes",
    finiteVerb: false,
    npTest: false,
    hybrid: false,
  },
  {
    description: "interrogative exemption",
    heading: "Why the Default Is Unsafe",
    finiteVerb: false,
    npTest: false,
    hybrid: false,
  },
  {
    description: "long verb-less noun phrase stays quiet",
    heading: "Programmatic, Conformant Schema Registration Guidance for Multi-Tenant Setups",
    finiteVerb: false,
    npTest: false,
    hybrid: false,
  },
  {
    description: "code identifiers stay quiet",
    heading: "Migrating getUserById Callers",
    finiteVerb: false,
    npTest: false,
    hybrid: false,
  },
];

describe("compromise candidates", () => {
  const finiteVerb = finiteVerbClassifier(compromiseTagger);
  const npTest = npTestClassifier(compromiseTagger);
  const hybrid = hybridClassifier(compromiseTagger);

  for (const testCase of compromiseCases) {
    it(testCase.description, () => {
      expect(finiteVerb.classify(testCase.heading).flagged).toBe(testCase.finiteVerb);
      expect(npTest.classify(testCase.heading).flagged).toBe(testCase.npTest);
      expect(hybrid.classify(testCase.heading).flagged).toBe(testCase.hybrid);
    });
  }
});
