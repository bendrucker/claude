import { describe, expect, it } from "bun:test";
import { firstByTier, type PatternMatch, scan, stripCode } from "./tropes";

describe("stripCode", () => {
  it("removes fenced code blocks", () => {
    const text = "Before\n```\ndelve into code\n```\nAfter";
    expect(stripCode(text)).toBe("Before\n\nAfter");
  });

  it("removes inline code", () => {
    const text = "The `delve` function is useful";
    expect(stripCode(text)).toBe("The  function is useful");
  });

  it("preserves non-code text", () => {
    const text = "This is plain text";
    expect(stripCode(text)).toBe("This is plain text");
  });
});

describe("scan", () => {
  describe("spaced em dashes", () => {
    it("detects spaced em dash", () => {
      const matches = scan("This is \u2014 a problem");
      expect(matches).toHaveLength(1);
      expect(matches[0]?.tier).toBe("deny");
      expect(matches[0]?.category).toBe("spaced em dash");
    });

    it("allows unspaced em dash", () => {
      const matches = scan("This is\u2014fine");
      const deny = firstByTier(matches, "deny");
      expect(deny).toBeUndefined();
    });

    it("allows en dash with spaces", () => {
      const matches = scan("2024 \u2013 2025");
      const deny = firstByTier(matches, "deny");
      expect(deny).toBeUndefined();
    });
  });

  describe("AI vocabulary", () => {
    const words = [
      "delve",
      "tapestry",
      "landscape",
      "meticulous",
      "meticulously",
      "pivotal",
      "testament",
      "underscored",
      "interplay",
      "intricacies",
      "bolstered",
      "garnered",
      "fostering",
    ];

    for (const word of words) {
      it(`detects "${word}"`, () => {
        const matches = scan(`The ${word} of the project`);
        const deny = firstByTier(matches, "deny");
        expect(deny).toBeDefined();
        expect(deny?.category).toBe("AI vocabulary");
      });
    }

    it("ignores words in fenced code blocks", () => {
      const matches = scan("```\ndelve into code\n```");
      const deny = firstByTier(matches, "deny");
      expect(deny).toBeUndefined();
    });

    it("ignores words in inline code", () => {
      const matches = scan("The `delve` function");
      const deny = firstByTier(matches, "deny");
      expect(deny).toBeUndefined();
    });
  });

  describe("copula avoidance", () => {
    it('detects "serves as"', () => {
      const matches = scan("The module serves as the entry point");
      const deny = firstByTier(matches, "deny");
      expect(deny).toBeDefined();
      expect(deny?.category).toBe("copula avoidance");
    });

    it('detects "stands as"', () => {
      const matches = scan("This stands as a reminder");
      const deny = firstByTier(matches, "deny");
      expect(deny).toBeDefined();
    });

    it("does not flag 'serves food'", () => {
      const matches = scan("The restaurant serves food");
      const deny = firstByTier(matches, "deny");
      expect(deny).toBeUndefined();
    });
  });

  describe("promotional language", () => {
    it('detects "boasts"', () => {
      const matches = scan("The library boasts excellent performance");
      const context = firstByTier(matches, "context");
      expect(context).toBeDefined();
      expect(context?.category).toBe("promotional language");
    });

    it('detects "groundbreaking"', () => {
      const matches = scan("A groundbreaking approach");
      const context = firstByTier(matches, "context");
      expect(context).toBeDefined();
    });
  });

  describe("parallelism", () => {
    it('detects "not just X, but also Y"', () => {
      const matches = scan("It is not just fast, but also reliable");
      const context = firstByTier(matches, "context");
      expect(context).toBeDefined();
      expect(context?.category).toBe("parallelism");
    });

    it('detects "not only X, but Y"', () => {
      const matches = scan("This not only improves speed, but reduces memory");
      const context = firstByTier(matches, "context");
      expect(context).toBeDefined();
    });

    it("does not flag 'not just yet'", () => {
      const matches = scan("Not just yet");
      const context = firstByTier(matches, "context");
      expect(context).toBeUndefined();
    });
  });

  describe("semicolon overuse", () => {
    it("detects three semicolons in proximity", () => {
      const matches = scan("First point; second point; third point; fourth");
      const context = firstByTier(matches, "context");
      expect(context).toBeDefined();
      expect(context?.category).toBe("semicolon overuse");
    });

    it("allows a single semicolon", () => {
      const text = "First clause; second clause.";
      const matches = scan(text);
      const semicolon = matches.find((m) => m.category === "semicolon overuse");
      expect(semicolon).toBeUndefined();
    });

    it("allows two semicolons", () => {
      const text = "First; second; third.";
      const matches = scan(text);
      const semicolon = matches.find((m) => m.category === "semicolon overuse");
      expect(semicolon).toBeUndefined();
    });
  });

  describe("tier short-circuiting", () => {
    it("returns at most one match per tier", () => {
      const matches = scan("This delve serves as a testament");
      const denyMatches = matches.filter((m) => m.tier === "deny");
      expect(denyMatches).toHaveLength(1);
    });
  });

  describe("empty and clean input", () => {
    it("returns empty for empty string", () => {
      expect(scan("")).toHaveLength(0);
    });

    it("returns empty for clean prose", () => {
      expect(scan("The function processes input and returns a result.")).toHaveLength(0);
    });
  });
});

describe("firstByTier", () => {
  it("finds first deny match", () => {
    const matches: PatternMatch[] = [
      { tier: "context", category: "test", matched: "x", message: "x" },
      { tier: "deny", category: "test", matched: "y", message: "y" },
    ];
    expect(firstByTier(matches, "deny")?.matched).toBe("y");
  });

  it("returns undefined when tier not found", () => {
    const matches: PatternMatch[] = [
      {
        tier: "context",
        category: "test",
        matched: "x",
        message: "x",
      },
    ];
    expect(firstByTier(matches, "deny")).toBeUndefined();
  });
});
