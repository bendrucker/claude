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

    it("stays silent on a single splice in prose", async () => {
      expect(
        (await scan(oneSplice)).find((m) => m.category === "semicolon splice"),
      ).toBeUndefined();
    });

    it.each(["script.sh", "index.ts"])("skips in %s", async (path) => {
      expect(
        (await scan(twoSplices, path)).find((m) => m.category === "semicolon splice"),
      ).toBeUndefined();
    });
  });
});
