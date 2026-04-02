import { describe, expect, it } from "bun:test";
import { firstByTier, type PatternMatch, scan, stripCode } from "./tropes";

describe("stripCode", () => {
  it("removes fenced code blocks", () => {
    expect(stripCode("Before\n```\ndelve into code\n```\nAfter")).toBe("Before\n\nAfter");
  });

  it("removes inline code", () => {
    expect(stripCode("The `delve` function is useful")).toBe("The  function is useful");
  });

  it("preserves non-code text", () => {
    expect(stripCode("This is plain text")).toBe("This is plain text");
  });
});

describe("scan", () => {
  describe("spaced em dashes", () => {
    it("detects spaced em dash", () => {
      const match = scan("This is \u2014 a problem");
      expect(match[0]?.tier).toBe("deny");
      expect(match[0]?.category).toBe("spaced em dash");
    });

    for (const allowed of ["This is\u2014fine", "2024 \u2013 2025"]) {
      it(`allows: "${allowed}"`, () => {
        expect(firstByTier(scan(allowed), "deny")).toBeUndefined();
      });
    }
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
        const deny = firstByTier(scan(`The ${word} of the project`), "deny");
        expect(deny?.category).toBe("AI vocabulary");
      });
    }

    for (const safe of ["```\ndelve into code\n```", "The `delve` function"]) {
      it(`ignores in code: "${safe.slice(0, 30)}..."`, () => {
        expect(firstByTier(scan(safe), "deny")).toBeUndefined();
      });
    }
  });

  describe("copula avoidance", () => {
    const deny = ["The module serves as the entry point", "This stands as a reminder"];
    const allow = ["The restaurant serves food"];

    for (const text of deny) {
      it(`flags: "${text}"`, () => {
        expect(firstByTier(scan(text), "deny")?.category).toBe("copula avoidance");
      });
    }

    for (const text of allow) {
      it(`allows: "${text}"`, () => {
        expect(firstByTier(scan(text), "deny")).toBeUndefined();
      });
    }
  });

  describe("test result reporting", () => {
    const shouldFlag = [
      "All 8 tests pass. Now let me run the full test suite for this file:",
      "All tests pass. Now create the skill and update the README.",
      "All 35 tests pass. Let me also lint:",
      "All 20 pass. Now verify against real data:",
      "All 91 tests pass. Let me check if the code reviewer has finished.",
      "Tests pass (46/46). The tsc errors are pre-existing.",
      "All 45 tests pass. Let me also verify biome is clean.",
      "All linting passes, marketplace check passes. Let me commit.",
      "All hooks passed. Now push and create the draft PR.",
      "Build passes. The fix is good.",
      "Build passes too. Ready to commit.",
      "Test passes, line 252 is covered, lint and format are clean.",
      "All CI checks pass. Now let me update the Things todo.",
      "PR #509 CI is now green.",
      "Both PRs are green and ready for review.",
      "CI passed. Now I'll update the Things todos.",
      "Done. 54/57 succeeded, 3 failed. Let me check the failures.",
      "All 12 tests pass (including the 2 new tool approval tests).",
      "All 555 unit tests pass.",
      "Typecheck passes. Server looks good.",
      "Lint passed now. Let me get the test failure details.",
      "Skill lint passes. The marketplace check failure is pre-existing.",
      "All 25 pass. Let me also verify end-to-end:",
      "All passing. Let me also run the full E2E suite:",
      "3/3 passing on Sonnet 4.6.",
      "0 errors from dispatch or launch.",
      "Type checking passes (0 errors).",
      "#202 rebased and pushed. Auto-merge is still enabled so it'll merge once CI passes.",
      "Pushed and auto-merge enabled. It'll squash-merge once checks pass.",
    ];

    const shouldNotFlag = [
      "Good, no conflicts. Now let me write the CI check script.",
      "Now simplify all generators.",
      "Let me find the actual test file and failing test names.",
      "Let me check the CI workflow to see where to add the DuckDB CLI install.",
      "The tests fail because processInput is now async.",
      "Reproduced. Let me read the failing lines.",
      "Let me check what test is failing at line 226:",
      "Also need to add workflow_dispatch to the CI trigger.",
      "Pushed. Now let me monitor CI.",
      "Let me wait for CI and check the runs.",
      "The push went through but CI hasn't triggered yet.",
      "Now pass the icon from Part.tsx:",
      "Let me look at the existing test pattern for dispatch_request mocking.",
      "No changes. Now commit and push the fail-fast branch.",
      "The template substitution works. Let me pass it via 1Password.",
      "3 skipped locally, will run in CI. Ready to commit.",
      "Tests cover the new validation logic.",
      "Write a test for this function.",
    ];

    for (const text of shouldFlag) {
      it(`flags: "${text.slice(0, 60)}..."`, () => {
        expect(firstByTier(scan(text), "context")?.category).toBe("test result reporting");
      });
    }

    for (const text of shouldNotFlag) {
      it(`allows: "${text.slice(0, 60)}..."`, () => {
        expect(scan(text).find((m) => m.category === "test result reporting")).toBeUndefined();
      });
    }
  });

  describe("promotional language", () => {
    const flag = ["The library boasts excellent performance", "A groundbreaking approach"];

    for (const text of flag) {
      it(`flags: "${text}"`, () => {
        expect(firstByTier(scan(text), "context")?.category).toBe("promotional language");
      });
    }
  });

  describe("parallelism", () => {
    const flag = [
      "It is not just fast, but also reliable",
      "This not only improves speed, but reduces memory",
    ];
    const allow = ["Not just yet"];

    for (const text of flag) {
      it(`flags: "${text}"`, () => {
        expect(firstByTier(scan(text), "context")?.category).toBe("parallelism");
      });
    }

    for (const text of allow) {
      it(`allows: "${text}"`, () => {
        expect(firstByTier(scan(text), "context")).toBeUndefined();
      });
    }
  });

  describe("semicolon overuse", () => {
    const text = "First point; second point; third point; fourth";

    it("detects three semicolons in proximity", () => {
      expect(firstByTier(scan(text), "context")?.category).toBe("semicolon overuse");
    });

    it("detects in prose files", () => {
      expect(firstByTier(scan(text, "doc.md"), "context")?.category).toBe("semicolon overuse");
    });

    it("skips in code files", () => {
      expect(scan(text, "script.sh").find((m) => m.category === "semicolon overuse")).toBeUndefined();
    });

    it("skips in CSS files", () => {
      expect(scan(text, "style.css").find((m) => m.category === "semicolon overuse")).toBeUndefined();
    });

    for (const allowed of ["First clause; second clause.", "First; second; third."]) {
      it(`allows: "${allowed}"`, () => {
        expect(scan(allowed).find((m) => m.category === "semicolon overuse")).toBeUndefined();
      });
    }
  });

  it("returns at most one match per tier", () => {
    const denyMatches = scan("This delve serves as a testament").filter((m) => m.tier === "deny");
    expect(denyMatches).toHaveLength(1);
  });

  it("returns empty for empty string", () => {
    expect(scan("")).toHaveLength(0);
  });

  it("returns empty for clean prose", () => {
    expect(scan("The function processes input and returns a result.")).toHaveLength(0);
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
      { tier: "context", category: "test", matched: "x", message: "x" },
    ];
    expect(firstByTier(matches, "deny")).toBeUndefined();
  });
});
