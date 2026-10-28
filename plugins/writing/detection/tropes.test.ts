import { describe, expect, it, test } from "bun:test";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
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
  const plainSegment = gs.text().map((s) => s.replaceAll(/[`\n]/g, ""));
  const inlineCodeLine = gs
    .tuples(
      plainSegment,
      gs.text().map((s) => {
        const stripped = s.replaceAll(/[`\n]/g, "");
        return stripped !== "" ? stripped : "x";
      }),
      plainSegment,
    )
    .map(([pre, code, post]) => `${pre}\`${code}\`${post}`);
  const fencedBlock = gs.arrays(plainSegment).map((lines) => `\`\`\`\n${lines.join("\n")}\n\`\`\``);
  const codeSafeText = gs
    .arrays(gs.oneOf(plainSegment, inlineCodeLine, fencedBlock))
    .map((blocks) => blocks.join("\n"));

  it("preserves line count for well-formed code spans", () => {
    hegel.test((tc) => {
      const text = tc.draw(codeSafeText);
      expect(stripCode(text).split("\n")).toHaveLength(text.split("\n").length);
    });
  });
});

describe("scan", () => {
  describe("connector density", () => {
    const semicolons =
      "The cache starts cold; the first request fills it. The retry logic backs off; later attempts succeed. The parser rejects malformed input; it returns an error. The server validates each field. The client sends a token. The job runs nightly.";
    const emDashes =
      "The cache starts cold—the first request fills it. The retry logic backs off—later attempts succeed. The parser rejects malformed input—it returns an error. The server validates each field. The client sends a token. The job runs nightly.";
    const mixed =
      "The cache starts cold; the first request fills it. The retry logic backs off—later attempts succeed. The parser rejects malformed input - it returns an error. The server validates each field. The client sends a token. The job runs nightly.";
    const hyphen =
      "The cache starts cold - the first request fills it. The retry logic backs off - later attempts succeed. The parser rejects malformed input - it returns an error. The server validates each field. The client sends a token. The job runs nightly.";

    it.each([
      ["semicolons", semicolons],
      ["unspaced em dashes", emDashes],
      ["mixed connectors", mixed],
      ["letter-flanked hyphens", hyphen],
    ] as const)("flags %s", async (_name, text) => {
      expect(firstByTier(await scan(text), "context")?.category).toBe("connector density");
    });

    it("fires at exactly 30% density (3 of 10)", async () => {
      const text =
        "The cache starts cold; it fills later. The retry logic backs off; it succeeds. The parser rejects input; it errors. The server validates each field. The client sends a token. The job runs nightly. The worker drains the queue. The log rotates each day. The metric updates often. The alert fires rarely.";
      expect(firstByTier(await scan(text), "context")?.category).toBe("connector density");
    });

    it("does not fire below MIN_CONNECTOR_SENTENCES (2 of 10)", async () => {
      const text =
        "The cache starts cold; it fills later. The retry logic backs off; it succeeds. The parser rejects input and errors. The server validates each field. The client sends a token. The job runs nightly. The worker drains the queue. The log rotates each day. The metric updates often. The alert fires rarely.";
      expect((await scan(text)).find((m) => m.category === "connector density")).toBeUndefined();
    });

    it("does not fire below MIN_SENTENCES (4 all connectored)", async () => {
      const text =
        "The cache starts cold; it fills later. The retry logic backs off; it succeeds. The parser rejects input; it errors. The server validates; it stops.";
      expect((await scan(text)).find((m) => m.category === "connector density")).toBeUndefined();
    });

    it("does not fire below density threshold (3 of 11, 27%)", async () => {
      const text =
        "The cache starts cold; it fills later. The retry logic backs off; it succeeds. The parser rejects input; it errors. The server validates each field. The client sends a token. The job runs nightly. The worker drains the queue. The log rotates each day. The metric updates often. The alert fires rarely. The cron schedules the task.";
      expect((await scan(text)).find((m) => m.category === "connector density")).toBeUndefined();
    });

    it("does not fire on one semicolon list among clean sentences", async () => {
      const text =
        "The build depends on three steps; compile; link; package. The server validates each field. The client sends a token. The job runs nightly. The worker drains the queue. The log rotates each day. The metric updates often. The alert fires rarely. The cron schedules the task. The cache warms slowly.";
      expect((await scan(text)).find((m) => m.category === "connector density")).toBeUndefined();
    });

    it("does not fire on a numeric range", async () => {
      const text =
        "The project ran from 2024 - 2025 without issues. The server validates each field. The client sends a token. The job runs nightly. The worker drains the queue. The log rotates each day.";
      expect((await scan(text)).find((m) => m.category === "connector density")).toBeUndefined();
    });

    it("does not fire on markdown table rows alone", async () => {
      const text = [
        "| col a | col b | col c |",
        "| --- | --- | --- |",
        "| x; y | a; b | p; q |",
        "| m; n | c; d | r; s |",
        "| e; f | g; h | i; j |",
        "| k; l | u; v | w; z |",
      ].join("\n");
      expect((await scan(text)).find((m) => m.category === "connector density")).toBeUndefined();
    });

    it("does not fire on a two-sentence text", async () => {
      const text = "The cache starts cold; it fills later. The retry logic backs off; it succeeds.";
      expect((await scan(text)).find((m) => m.category === "connector density")).toBeUndefined();
    });

    it("does not fire on a definition bullet list", async () => {
      const text = [
        "- **jxa** — JXA language guide for automation",
        "- **jxa-run** — App-scoped JXA runner with validation",
        "- **sandbox** — Detects Go binaries and disables the sandbox",
        "- **shortcut** — Author shortcuts as plain text",
        "- **xcall** — Send x-callback-url requests",
        "- **tmux** — Layout awareness and pane management",
      ].join("\n");
      expect(
        (await scan(text, "README.md")).find((m) => m.category === "connector density"),
      ).toBeUndefined();
    });

    it("does not fire on a numbered definition list", async () => {
      const text = [
        "1. Flowchart — nodes and edges here",
        "2. Sequence — participants and messages",
        "3. State — states and transitions here",
        "4. ER — entities and relationships here",
        "5. Class — members and methods here",
        "6. Gantt — tasks and milestones here",
      ].join("\n");
      expect(
        (await scan(text, "doc.md")).find((m) => m.category === "connector density"),
      ).toBeUndefined();
    });

    it("does not fire on reference-link bullets with periods in the path", async () => {
      const text = [
        "- [Flowchart](./references/flowchart.md) — Nodes, edges, subgraphs, direction",
        "- [Sequence](./references/sequence.md) — Participants, messages, activations",
        "- [State](./references/state.md) — States, transitions, composite states",
        "- [ER](./references/er.md) — Entities, relationships, cardinality",
        "- [Class](./references/class.md) — Classes, members, relationships",
        "- [Gantt](./references/gantt.md) — Tasks, sections, milestones",
      ].join("\n");
      expect(
        (await scan(text, "SKILL.md")).find((m) => m.category === "connector density"),
      ).toBeUndefined();
    });

    it("does not fire on headings with hyphen subtitles", async () => {
      const text = [
        "## Flowchart - Basic",
        "## Flowchart - Unclosed Bracket",
        "## Sequence - Simple",
        "## State - Composite",
        "## ER - Cardinality",
        "## Class - Inheritance",
      ].join("\n");
      expect(
        (await scan(text, "doc.md")).find((m) => m.category === "connector density"),
      ).toBeUndefined();
    });

    it("detects in prose files", async () => {
      expect(firstByTier(await scan(semicolons, "doc.md"), "context")?.category).toBe(
        "connector density",
      );
    });

    it("applies when no path is given", async () => {
      expect(firstByTier(await scan(semicolons, undefined), "context")?.category).toBe(
        "connector density",
      );
    });

    it.each(["script.sh", "index.ts", "style.css"])("skips in %s", async (path) => {
      expect(
        (await scan(semicolons, path)).find((m) => m.category === "connector density"),
      ).toBeUndefined();
    });
  });

  it("returns empty for empty string", async () => {
    expect(await scan("")).toHaveLength(0);
  });

  it("returns empty for clean prose", async () => {
    expect(await scan("The function processes input and returns a result.")).toHaveLength(0);
  });

  describe("sycophantic opener", () => {
    it("does not fire when openers.txt is empty", async () => {
      expect(
        (await scan("Excellent. That works.")).find((m) => m.category === "sycophantic opener"),
      ).toBeUndefined();
    });
  });

  describe("skillOnly patterns stay out of the hook", () => {
    it.each([
      ["rides on", "The teardown rides on the normal end of a team."],
      ["can bite", "A stale cache entry can bite at runtime."],
      ["surface as verb", "The hook should surface the conflict to the user."],
    ])("scan() does not report %s", async (category, text) => {
      expect(
        (await scan(text, "doc.md", "file")).find((m) => m.category === category),
      ).toBeUndefined();
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

  describe("copula avoidance", () => {
    const deny = ["The module serves as the entry point", "This stands as a reminder"];
    const allow = ["The restaurant serves food"];

    it.each(deny)('flags: "%s"', async (text) => {
      expect(firstByTier(await scan(text), "deny")?.category).toBe("copula avoidance");
    });

    it.each(allow)('allows: "%s"', async (text) => {
      expect(firstByTier(await scan(text), "deny")).toBeUndefined();
    });
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

    it("flags two splices in short prose below the density gate", async () => {
      expect((await scan(twoSplices)).find((m) => m.category === "semicolon splice")).toBeDefined();
    });

    it("stays silent on a single splice in prose", async () => {
      expect(
        (await scan(oneSplice)).find((m) => m.category === "semicolon splice"),
      ).toBeUndefined();
    });

    it("detects in prose files", async () => {
      expect(
        (await scan(twoSplices, "doc.md")).find((m) => m.category === "semicolon splice"),
      ).toBeDefined();
    });

    it.each(["script.sh", "index.ts"])("skips in %s", async (path) => {
      expect(
        (await scan(twoSplices, path)).find((m) => m.category === "semicolon splice"),
      ).toBeUndefined();
    });
  });
});
