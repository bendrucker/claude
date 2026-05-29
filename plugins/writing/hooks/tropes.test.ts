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
      "meticulous",
      "meticulously",
      "leverage",
      "leveraged",
      "robust",
      "comprehensive",
      "comprehensively",
      "nuance",
      "nuanced",
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
      expect(
        scan(text, "script.sh").find((m) => m.category === "semicolon overuse"),
      ).toBeUndefined();
    });

    it("skips in CSS files", () => {
      expect(
        scan(text, "style.css").find((m) => m.category === "semicolon overuse"),
      ).toBeUndefined();
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

  describe("sycophantic opener", () => {
    const flag = ["Excellent. That works.", "Excellent! Moving on."];
    const allow = [
      "This was a perfect example of the issue.",
      "An excellent question to consider.",
      "It is great that the migration shipped.",
    ];

    for (const text of flag) {
      it(`flags: "${text}"`, () => {
        expect(firstByTier(scan(text), "deny")?.category).toBe("sycophantic opener");
      });
    }

    for (const text of allow) {
      it(`allows: "${text}"`, () => {
        expect(scan(text).find((m) => m.category === "sycophantic opener")).toBeUndefined();
      });
    }
  });

  describe("sycophantic acknowledgment", () => {
    it("flags: You're right", () => {
      expect(firstByTier(scan("You're right, that was wrong."), "deny")?.category).toBe(
        "sycophantic acknowledgment",
      );
    });

    it("flags: You're absolutely right", () => {
      expect(firstByTier(scan("You're absolutely right about that."), "deny")?.category).toBe(
        "sycophantic acknowledgment",
      );
    });

    it("allows: turn right", () => {
      expect(
        scan("Turn right at the corner.").find((m) => m.category === "sycophantic acknowledgment"),
      ).toBeUndefined();
    });
  });

  describe("permission-seeking", () => {
    it("flags: want me to fix", () => {
      expect(firstByTier(scan("Want me to fix the bug?"), "deny")?.category).toBe(
        "permission-seeking",
      );
    });

    it("allows: they want me there", () => {
      expect(
        scan("They want me there by noon.").find((m) => m.category === "permission-seeking"),
      ).toBeUndefined();
    });
  });

  describe("hedging close", () => {
    it("flags: would you like", () => {
      expect(firstByTier(scan("Would you like me to retry?"), "deny")?.category).toBe(
        "hedging close",
      );
    });
  });

  describe("reaching for", () => {
    const flag = [
      "Open a sibling pane rather than reaching for Bash.",
      "Reach for the linter before the formatter.",
    ];
    for (const text of flag) {
      it(`flags: "${text}"`, () => {
        expect(firstByTier(scan(text), "deny")?.category).toBe("reaching for");
      });
    }
  });

  describe("cross-sentence not-X", () => {
    it("flags: It isn't X. It is Y.", () => {
      expect(firstByTier(scan("It isn't broken. It is slow."), "context")?.category).toBe(
        "cross-sentence not-X",
      );
    });

    it("allows: single-sentence negation", () => {
      expect(
        scan("It isn't broken.").find((m) => m.category === "cross-sentence not-X"),
      ).toBeUndefined();
    });
  });

  describe("passive PR summary", () => {
    it("flags in markdown: 'is added'", () => {
      expect(
        firstByTier(scan("Retry logic is added to the HTTP client.", "pr.md"), "context")?.category,
      ).toBe("passive PR summary");
    });

    it("flags in markdown: 'was refactored'", () => {
      expect(
        firstByTier(scan("The cache layer was refactored last week.", "pr.md"), "context")
          ?.category,
      ).toBe("passive PR summary");
    });

    it("skips in code files", () => {
      expect(
        scan("retry logic is added to the http client", "index.ts").find(
          (m) => m.category === "passive PR summary",
        ),
      ).toBeUndefined();
    });
  });

  describe("tests cover preamble", () => {
    it("flags: 'Tests cover ...'", () => {
      expect(
        firstByTier(scan("Tests cover error handling for malformed JSON."), "context")?.category,
      ).toBe("tests cover preamble");
    });

    it("allows: 'Added tests covering ...'", () => {
      expect(
        scan("Added tests covering the error handling for malformed JSON.").find(
          (m) => m.category === "tests cover preamble",
        ),
      ).toBeUndefined();
    });
  });

  describe("path bullet", () => {
    it("flags in markdown", () => {
      expect(
        firstByTier(scan("- **src/foo.ts**: refactors the helper", "doc.md"), "context")?.category,
      ).toBe("path bullet");
    });

    it("skips in code files", () => {
      expect(
        scan("- **src/foo.ts**: refactors the helper", "index.ts").find(
          (m) => m.category === "path bullet",
        ),
      ).toBeUndefined();
    });
  });

  describe("trailing hedge", () => {
    it("flags in markdown: 'regardless.' at line end", () => {
      expect(
        firstByTier(
          scan("It keeps the running shells stale regardless.\nNext sentence.", "doc.md"),
          "context",
        )?.category,
      ).toBe("trailing hedge");
    });
  });

  describe("label bold", () => {
    it("flags in markdown: '**Why:**' label", () => {
      expect(firstByTier(scan("**Why:** the diff is small", "doc.md"), "context")?.category).toBe(
        "label bold",
      );
    });

    it("skips in code files", () => {
      expect(
        scan("**Why:** the diff is small", "index.ts").find((m) => m.category === "label bold"),
      ).toBeUndefined();
    });
  });

  describe("dig into", () => {
    it("flags: 'dig into the codebase'", () => {
      expect(firstByTier(scan("Let's dig into the codebase."), "context")?.category).toBe(
        "dig into",
      );
    });

    it("flags: 'dive into the data'", () => {
      expect(firstByTier(scan("We'll dive into the data later."), "context")?.category).toBe(
        "dig into",
      );
    });
  });

  describe("hedging observation", () => {
    it("flags: looks like", () => {
      expect(firstByTier(scan("This looks like a regression."), "context")?.category).toBe(
        "hedging observation",
      );
    });

    it("flags: appears to", () => {
      expect(firstByTier(scan("The fix appears to hold."), "context")?.category).toBe(
        "hedging observation",
      );
    });
  });

  describe("I understand", () => {
    it("flags: 'I understand the issue'", () => {
      expect(firstByTier(scan("I understand the issue."), "context")?.category).toBe(
        "I understand",
      );
    });

    it("allows: 'do you understand'", () => {
      expect(
        scan("Do you understand the issue?").find((m) => m.category === "I understand"),
      ).toBeUndefined();
    });
  });

  describe("sideEffectOnly scoping", () => {
    const conversational = [
      { text: "Excellent. That works.", category: "sycophantic opener" },
      { text: "You're right about that.", category: "sycophantic acknowledgment" },
      { text: "Want me to fix the bug?", category: "permission-seeking" },
      { text: "Would you like me to retry?", category: "hedging close" },
      { text: "I understand the issue.", category: "I understand" },
    ];

    for (const { text, category } of conversational) {
      it(`fires without context: "${text.slice(0, 40)}"`, () => {
        expect(scan(text).find((m) => m.category === category)).toBeDefined();
      });

      it(`fires in sideEffect context: "${text.slice(0, 40)}"`, () => {
        expect(
          scan(text, undefined, "sideEffect").find((m) => m.category === category),
        ).toBeDefined();
      });

      it(`skips in file context: "${text.slice(0, 40)}"`, () => {
        expect(scan(text, undefined, "file").find((m) => m.category === category)).toBeUndefined();
      });
    }

    it("non-conversational patterns still fire in file context", () => {
      expect(
        firstByTier(scan("The tapestry of the project", undefined, "file"), "deny")?.category,
      ).toBe("AI vocabulary");
    });
  });

  describe("marketing verbs (weighted)", () => {
    it("does not flag a single low-weight hit", () => {
      // enhance is 1.5, below the 3.0 threshold on its own.
      expect(
        scan("This change enhances the workflow.").find((m) => m.category === "marketing verbs"),
      ).toBeUndefined();
    });

    it("does not flag a single mid-weight hit below threshold", () => {
      // empower is 2.5, below the 3.0 threshold on its own.
      expect(
        scan("This release empowers users.").find((m) => m.category === "marketing verbs"),
      ).toBeUndefined();
    });

    it("flags when stacked verbs clear the threshold", () => {
      // empower (2.5) + streamline (1.5) = 4.0, above 3.0.
      const text = "This release empowers users and streamlines deploys.";
      expect(firstByTier(scan(text), "context")?.category).toBe("marketing verbs");
    });

    it("flags repeated high-weight hits", () => {
      // Two occurrences of empower (2.5 each) = 5.0, well above 3.0.
      const text = "This empowers teams. That empowers customers.";
      expect(firstByTier(scan(text), "context")?.category).toBe("marketing verbs");
    });
  });

  describe("flowery phrasing", () => {
    const flag = [
      "this keeps a single source of truth",
      "the canonical sources of truth live here",
      "stored as source-of-truth metadata",
      "treat it as the Source Of Truth",
      "added an escape hatch for power users",
      "two escape hatches remain",
      "the module is fully self-sufficient",
      "the fixture is self sufficient",
      "the assertion fails loudly on drift",
      "it failed loudly during CI",
    ];
    const allow = [
      "the truth about the data source is unclear",
      "a hatch you can escape through",
      "loudly proclaimed the failure",
    ];
    for (const text of flag) {
      it(`flags ${JSON.stringify(text)}`, () => {
        expect(firstByTier(scan(text), "context")?.category).toBe("flowery phrasing");
      });
    }
    for (const text of allow) {
      it(`allows ${JSON.stringify(text)}`, () => {
        expect(scan(text).find((m) => m.category === "flowery phrasing")).toBeUndefined();
      });
    }
    it("does not fire in non-prose file context", () => {
      expect(
        scan("a single source of truth", "module.ts", "file").find(
          (m) => m.category === "flowery phrasing",
        ),
      ).toBeUndefined();
    });
    it("fires in prose file context", () => {
      expect(
        firstByTier(scan("a single source of truth", "README.md", "file"), "context")?.category,
      ).toBe("flowery phrasing");
    });
  });

  describe("soft phrasing (weighted)", () => {
    it("does not flag a lone soft word", () => {
      // cleanly is 1.5, below the 3.0 threshold on its own.
      expect(
        scan("the fixtures strip cleanly").find((m) => m.category === "soft phrasing"),
      ).toBeUndefined();
    });

    it("flags when soft words stack", () => {
      // Two occurrences of cleanly (1.5 each) = 3.0, at the threshold.
      const text = "the migration runs cleanly and the tests strip cleanly";
      expect(firstByTier(scan(text), "context")?.category).toBe("soft phrasing");
    });

    it("does not fire in non-prose file context", () => {
      const text = "the migration runs cleanly and the tests strip cleanly";
      expect(
        scan(text, "module.ts", "file").find((m) => m.category === "soft phrasing"),
      ).toBeUndefined();
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
      { tier: "context", category: "test", matched: "x", message: "x" },
    ];
    expect(firstByTier(matches, "deny")).toBeUndefined();
  });
});
