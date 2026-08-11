import { describe, expect, it, test } from "bun:test";
import fc from "fast-check";
import {
  firstByTier,
  type PatternMatch,
  regexCatalog,
  scan,
  semicolonSpliceHits,
  stripCode,
} from "./tropes";

describe("regexCatalog", () => {
  it("returns globalized regex patterns for counting", () => {
    for (const entry of regexCatalog()) {
      expect(entry.pattern.global).toBe(true);
    }
  });

  it("includes a known structural pattern and excludes wordlist-backed ones", () => {
    const categories = regexCatalog().map((entry) => entry.category);
    expect(categories).toContain("spaced em dash");
    expect(categories).not.toContain("sycophantic opener");
    expect(categories).not.toContain("AI vocabulary");
  });
});

describe("stripCode", () => {
  it("replaces fenced code blocks with their newline count", () => {
    expect(stripCode("Before\n```\ndelve into code\n```\nAfter")).toBe("Before\n\n\n\nAfter");
  });

  it("replaces inline code with equal-width spaces", () => {
    expect(stripCode("The `delve` function is useful")).toBe("The         function is useful");
  });

  it("preserves line count for fenced blocks", () => {
    const input = "line1\n```\ncode line\ncode line\n```\nline6";
    expect(stripCode(input).split("\n")).toHaveLength(input.split("\n").length);
  });

  it("preserves non-code text", () => {
    expect(stripCode("This is plain text")).toBe("This is plain text");
  });

  // Text whose backticks only form single-line inline spans or well-formed
  // fenced blocks. That is stripCode's intended domain: inline code that spans
  // a newline is replaced by equal-width spaces, which drops the newline and
  // collapses the line count.
  const plainSegment = fc.string().map((s) => s.replace(/[`\n]/g, ""));
  const inlineCodeLine = fc
    .tuple(
      plainSegment,
      fc.string().map((s) => s.replace(/[`\n]/g, "") || "x"),
      plainSegment,
    )
    .map(([pre, code, post]) => `${pre}\`${code}\`${post}`);
  const fencedBlock = fc.array(plainSegment).map((lines) => `\`\`\`\n${lines.join("\n")}\n\`\`\``);
  const codeSafeText = fc
    .array(fc.oneof(plainSegment, inlineCodeLine, fencedBlock))
    .map((blocks) => blocks.join("\n"));

  it("preserves line count for well-formed code spans", () => {
    fc.assert(
      fc.property(codeSafeText, (text) => {
        expect(stripCode(text).split("\n")).toHaveLength(text.split("\n").length);
      }),
    );
  });
});

describe("scan", () => {
  describe("spaced em dashes", () => {
    it("detects spaced em dash", () => {
      const match = scan("This is \u2014 a problem");
      expect(match[0]?.tier).toBe("deny");
      expect(match[0]?.category).toBe("spaced em dash");
    });

    it("steers toward splitting into two sentences", () => {
      const match = scan("This is \u2014 a problem");
      expect(match[0]?.message).toContain("two sentences");
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

  describe("no X needed brag", () => {
    // The flag side is open-ended: these artifact nouns are not enumerated
    // anywhere in the detector, proving it generalizes past a fixed list.
    const flag = [
      "Handlers are auto-discovered, no config needed.",
      "It runs inline (no wrapper needed).",
      "Spin it up with no docker needed.",
      "Drop the file in place, no namespace required.",
      "It reads the token directly, no auth needed.",
    ];
    const allow = [
      "Reviewed the helper, no change needed.",
      "No further action needed here.",
      "Patch-ids matched, no rebase needed.",
      "No adjustment needed, it scales on its own.",
      "It is no longer needed.",
      "There is no way the runtime needed that much memory.",
    ];

    for (const text of flag) {
      it(`flags: "${text}"`, () => {
        expect(firstByTier(scan(text), "context")?.category).toBe("no X needed brag");
      });
    }

    for (const text of allow) {
      it(`allows: ${JSON.stringify(text)}`, () => {
        expect(scan(text).find((m) => m.category === "no X needed brag")).toBeUndefined();
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

  describe("connector density", () => {
    const semicolons =
      "The cache starts cold; the first request fills it. The retry logic backs off; later attempts succeed. The parser rejects malformed input; it returns an error. The server validates each field. The client sends a token. The job runs nightly.";
    const emDashes =
      "The cache starts cold—the first request fills it. The retry logic backs off—later attempts succeed. The parser rejects malformed input—it returns an error. The server validates each field. The client sends a token. The job runs nightly.";
    const mixed =
      "The cache starts cold; the first request fills it. The retry logic backs off—later attempts succeed. The parser rejects malformed input - it returns an error. The server validates each field. The client sends a token. The job runs nightly.";
    const hyphen =
      "The cache starts cold - the first request fills it. The retry logic backs off - later attempts succeed. The parser rejects malformed input - it returns an error. The server validates each field. The client sends a token. The job runs nightly.";

    for (const [name, text] of [
      ["semicolons", semicolons],
      ["unspaced em dashes", emDashes],
      ["mixed connectors", mixed],
      ["letter-flanked hyphens", hyphen],
    ] as const) {
      it(`flags ${name}`, () => {
        expect(firstByTier(scan(text), "context")?.category).toBe("connector density");
      });
    }

    it("fires at exactly 30% density (3 of 10)", () => {
      const text =
        "The cache starts cold; it fills later. The retry logic backs off; it succeeds. The parser rejects input; it errors. The server validates each field. The client sends a token. The job runs nightly. The worker drains the queue. The log rotates each day. The metric updates often. The alert fires rarely.";
      expect(firstByTier(scan(text), "context")?.category).toBe("connector density");
    });

    it("does not fire below MIN_CONNECTOR_SENTENCES (2 of 10)", () => {
      const text =
        "The cache starts cold; it fills later. The retry logic backs off; it succeeds. The parser rejects input and errors. The server validates each field. The client sends a token. The job runs nightly. The worker drains the queue. The log rotates each day. The metric updates often. The alert fires rarely.";
      expect(scan(text).find((m) => m.category === "connector density")).toBeUndefined();
    });

    it("does not fire below MIN_SENTENCES (4 all connectored)", () => {
      const text =
        "The cache starts cold; it fills later. The retry logic backs off; it succeeds. The parser rejects input; it errors. The server validates; it stops.";
      expect(scan(text).find((m) => m.category === "connector density")).toBeUndefined();
    });

    it("does not fire below density threshold (3 of 11, 27%)", () => {
      const text =
        "The cache starts cold; it fills later. The retry logic backs off; it succeeds. The parser rejects input; it errors. The server validates each field. The client sends a token. The job runs nightly. The worker drains the queue. The log rotates each day. The metric updates often. The alert fires rarely. The cron schedules the task.";
      expect(scan(text).find((m) => m.category === "connector density")).toBeUndefined();
    });

    it("does not fire on one semicolon list among clean sentences", () => {
      const text =
        "The build depends on three steps; compile; link; package. The server validates each field. The client sends a token. The job runs nightly. The worker drains the queue. The log rotates each day. The metric updates often. The alert fires rarely. The cron schedules the task. The cache warms slowly.";
      expect(scan(text).find((m) => m.category === "connector density")).toBeUndefined();
    });

    it("does not fire on a numeric range", () => {
      const text =
        "The project ran from 2024 - 2025 without issues. The server validates each field. The client sends a token. The job runs nightly. The worker drains the queue. The log rotates each day.";
      expect(scan(text).find((m) => m.category === "connector density")).toBeUndefined();
    });

    it("does not fire on markdown table rows alone", () => {
      const text = [
        "| col a | col b | col c |",
        "| --- | --- | --- |",
        "| x; y | a; b | p; q |",
        "| m; n | c; d | r; s |",
        "| e; f | g; h | i; j |",
        "| k; l | u; v | w; z |",
      ].join("\n");
      expect(scan(text).find((m) => m.category === "connector density")).toBeUndefined();
    });

    it("does not fire on a two-sentence text", () => {
      const text = "The cache starts cold; it fills later. The retry logic backs off; it succeeds.";
      expect(scan(text).find((m) => m.category === "connector density")).toBeUndefined();
    });

    it("does not fire on a definition bullet list", () => {
      const text = [
        "- **jxa** — JXA language guide for automation",
        "- **jxa-run** — App-scoped JXA runner with validation",
        "- **sandbox** — Detects Go binaries and disables the sandbox",
        "- **shortcut** — Author shortcuts as plain text",
        "- **xcall** — Send x-callback-url requests",
        "- **tmux** — Layout awareness and pane management",
      ].join("\n");
      expect(
        scan(text, "README.md").find((m) => m.category === "connector density"),
      ).toBeUndefined();
    });

    it("does not fire on a numbered definition list", () => {
      const text = [
        "1. Flowchart — nodes and edges here",
        "2. Sequence — participants and messages",
        "3. State — states and transitions here",
        "4. ER — entities and relationships here",
        "5. Class — members and methods here",
        "6. Gantt — tasks and milestones here",
      ].join("\n");
      expect(scan(text, "doc.md").find((m) => m.category === "connector density")).toBeUndefined();
    });

    it("does not fire on reference-link bullets with periods in the path", () => {
      const text = [
        "- [Flowchart](./references/flowchart.md) — Nodes, edges, subgraphs, direction",
        "- [Sequence](./references/sequence.md) — Participants, messages, activations",
        "- [State](./references/state.md) — States, transitions, composite states",
        "- [ER](./references/er.md) — Entities, relationships, cardinality",
        "- [Class](./references/class.md) — Classes, members, relationships",
        "- [Gantt](./references/gantt.md) — Tasks, sections, milestones",
      ].join("\n");
      expect(
        scan(text, "SKILL.md").find((m) => m.category === "connector density"),
      ).toBeUndefined();
    });

    it("does not fire on headings with hyphen subtitles", () => {
      const text = [
        "## Flowchart - Basic",
        "## Flowchart - Unclosed Bracket",
        "## Sequence - Simple",
        "## State - Composite",
        "## ER - Cardinality",
        "## Class - Inheritance",
      ].join("\n");
      expect(scan(text, "doc.md").find((m) => m.category === "connector density")).toBeUndefined();
    });

    it("detects in prose files", () => {
      expect(firstByTier(scan(semicolons, "doc.md"), "context")?.category).toBe(
        "connector density",
      );
    });

    it("applies when no path is given", () => {
      expect(firstByTier(scan(semicolons, undefined), "context")?.category).toBe(
        "connector density",
      );
    });

    for (const path of ["script.sh", "index.ts", "style.css"]) {
      it(`skips in ${path}`, () => {
        expect(
          scan(semicolons, path).find((m) => m.category === "connector density"),
        ).toBeUndefined();
      });
    }
  });

  describe("semicolon splice", () => {
    const twoSplices =
      "The cache starts cold; the first request fills it. The retry logic backs off; later attempts succeed.";
    const oneSplice =
      "The cache starts cold; the first request fills it. The retry logic backs off.";

    test.each<{ name: string; text: string; min: number; count: number }>([
      { name: "two splices counted at the prose threshold", text: twoSplices, min: 2, count: 2 },
      { name: "one splice silent at the prose threshold", text: oneSplice, min: 2, count: 0 },
      { name: "one splice counted at the comment threshold", text: oneSplice, min: 1, count: 1 },
      {
        name: "list-item semicolons skipped",
        text: "- compile the sources; link the objects\n- package the build; ship the artifact",
        min: 1,
        count: 0,
      },
      {
        name: "digit before the semicolon is not a splice",
        text: "The count was 2; see below. The limit was 3; see above.",
        min: 1,
        count: 0,
      },
      {
        name: "commented-out code is not a splice",
        text: "foo(); bar()",
        min: 1,
        count: 0,
      },
      {
        name: "uppercase clauses still splice",
        text: "The cache starts cold; The first request fills it. It retries; It succeeds.",
        min: 2,
        count: 2,
      },
    ])("$name", ({ text, min, count }) => {
      expect(semicolonSpliceHits(text, min).count).toBe(count);
    });

    it("flags two splices in short prose below the density gate", () => {
      expect(scan(twoSplices).find((m) => m.category === "semicolon splice")).toBeDefined();
    });

    it("stays silent on a single splice in prose", () => {
      expect(scan(oneSplice).find((m) => m.category === "semicolon splice")).toBeUndefined();
    });

    it("detects in prose files", () => {
      expect(
        scan(twoSplices, "doc.md").find((m) => m.category === "semicolon splice"),
      ).toBeDefined();
    });

    for (const path of ["script.sh", "index.ts"]) {
      it(`skips in ${path}`, () => {
        expect(
          scan(twoSplices, path).find((m) => m.category === "semicolon splice"),
        ).toBeUndefined();
      });
    }
  });

  it("returns all matches per tier", () => {
    const denyMatches = scan("This delve serves as a testament").filter((m) => m.tier === "deny");
    const categories = denyMatches.map((m) => m.category);
    expect(categories).toContain("AI vocabulary");
    expect(categories).toContain("copula avoidance");
  });

  it("returns empty for empty string", () => {
    expect(scan("")).toHaveLength(0);
  });

  it("returns empty for clean prose", () => {
    expect(scan("The function processes input and returns a result.")).toHaveLength(0);
  });

  describe("sycophantic opener", () => {
    it("does not fire when openers.txt is empty", () => {
      expect(
        scan("Excellent. That works.").find((m) => m.category === "sycophantic opener"),
      ).toBeUndefined();
    });
  });

  describe("sycophantic acknowledgment", () => {
    it.each([
      "You're right, that was wrong.",
      "You're absolutely right about that.",
    ])("flags: %j", (text) => {
      expect(firstByTier(scan(text), "deny")?.category).toBe("sycophantic acknowledgment");
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

  describe("contrast not", () => {
    const flag = [
      "This is a tool, not a framework.",
      "The goal is clarity, not perfection.",
      "We want specificity, not abstraction.",
      "It's a refactor, not a rewrite.",
      "Focus on outcomes, not process.",
      "Return an error, not an exception.",
      "a command-line tool, not a library",
    ];
    const allow = [
      "It is not the case that X.",
      "not only X, but Y",
      "a, not b",
      "Not a framework, but a tool",
      "Inline code: `foo, not bar`",
      "```\nif err != nil, not ok\n```",
    ];

    for (const text of flag) {
      it(`flags: "${text}"`, () => {
        expect(firstByTier(scan(text), "context")?.category).toBe("contrast not");
      });
    }

    for (const text of allow) {
      it(`allows: ${JSON.stringify(text)}`, () => {
        expect(scan(text).find((m) => m.category === "contrast not")).toBeUndefined();
      });
    }
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
    it.each([
      "Let's dig into the codebase.",
      "We'll dive into the data later.",
      "I dug into the parser internals.",
      "She dove into the schema migration.",
      "We're digging into the root cause.",
      "The audit dives into each subsystem.",
    ])("flags: %j", (text) => {
      expect(firstByTier(scan(text), "context")?.category).toBe("dig into");
    });

    it.each(["She dug a trench.", "Water drains into the basin."])("allows: %j", (text) => {
      expect(scan(text).find((m) => m.category === "dig into")).toBeUndefined();
    });
  });

  describe("hedging observation", () => {
    it.each(["This looks like a regression.", "The fix appears to hold."])("flags: %j", (text) => {
      expect(firstByTier(scan(text), "context")?.category).toBe("hedging observation");
    });
  });

  describe("filler", () => {
    it.each([
      "Importantly, the test was skipped.",
      "In terms of latency, it improved.",
    ])("flags: %j", (text) => {
      expect(firstByTier(scan(text), "context")?.category).toBe("filler");
    });

    it("allows prose without filler markers", () => {
      expect(scan("The cache starts cold.").find((m) => m.category === "filler")).toBeUndefined();
    });
  });

  describe("gravity markers", () => {
    it.each<{ text: string; category: string | undefined }>([
      { text: "The ordering here is load-bearing.", category: "load-bearing" },
      { text: "Removing the check breaks the parser.", category: undefined },
      { text: "The honest answer is the cache never worked.", category: "honest qualifier" },
      { text: "The prefix keeps the test honest.", category: undefined },
      { text: "Be honest about the coverage limits.", category: undefined },
      { text: "Two things worth flagging before this merges.", category: "attention-flag worth" },
      { text: "It's worth noting that the cache is cold.", category: "attention-flag worth" },
      { text: "One caveat worth your attention.", category: "attention-flag worth" },
      { text: "The refactor is worth doing before the freeze.", category: undefined },
      { text: "The fix is worth confirming against staging.", category: undefined },
    ])("$text -> $category", ({ text, category }) => {
      expect(firstByTier(scan(text), "context")?.category).toBe(category);
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
    it("does not flag a single hit below threshold", () => {
      // empower is 2.5, below the 3.0 threshold on its own.
      expect(
        scan("This release empowers users.").find((m) => m.category === "marketing verbs"),
      ).toBeUndefined();
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

  describe("skillOnly patterns stay out of the hook", () => {
    it.each([
      ["rides on", "The teardown rides on the normal end of a team."],
      ["can bite", "A stale cache entry can bite at runtime."],
      ["surface as verb", "The hook should surface the conflict to the user."],
    ])("scan() does not report %s", (category, text) => {
      expect(scan(text, "doc.md", "file").find((m) => m.category === category)).toBeUndefined();
    });
  });
});

describe("firstByTier", () => {
  it("finds first deny match", () => {
    const matches: PatternMatch[] = [
      { tier: "context", category: "test", matched: "x", message: "x", structural: false },
      { tier: "deny", category: "test", matched: "y", message: "y", structural: false },
    ];
    expect(firstByTier(matches, "deny")?.matched).toBe("y");
  });

  it("returns undefined when tier not found", () => {
    const matches: PatternMatch[] = [
      { tier: "context", category: "test", matched: "x", message: "x", structural: false },
    ];
    expect(firstByTier(matches, "deny")).toBeUndefined();
  });
});
