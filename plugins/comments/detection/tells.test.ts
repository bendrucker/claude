import { describe, expect, test } from "bun:test";
import type { TellId } from "./tells";
import { detectTells } from "./tells";
import type { Comment, CommentKind } from "./types";

function comment(text: string, kind: CommentKind = "line"): Comment {
  return {
    kind,
    text,
    startLine: 1,
    endLine: kind === "line" ? 1 : 3,
    startColumn: 0,
    endColumn: text.length,
  };
}

function ids(c: Comment): TellId[] {
  return detectTells(c).map((tell) => tell.id);
}

describe("roadmap-breadcrumb", () => {
  test.each([
    "# ENG-2217 tracks this",
    "# arrives with ENG-2065",
    "// ENG-2065",
    "# blocked on ABC-1234 for now",
  ])("matches a tracker reference: %s", (text) => {
    expect(ids(comment(text))).toContain("roadmap-breadcrumb");
  });

  test.each([
    "# encode the body as UTF-8",
    "# expect HTTP-200 on success",
    "# the X-9 flag",
  ])("does not match a near-miss: %s", (text) => {
    expect(ids(comment(text))).not.toContain("roadmap-breadcrumb");
  });
});

describe("line-number-crossref", () => {
  test.each([
    "# mirrors the guard at line 1208",
    "// see the check At Line 42",
  ])("matches a hardcoded line pointer: %s", (text) => {
    expect(ids(comment(text))).toContain("line-number-crossref");
  });

  test.each([
    "# read the first line of input",
    "# at line breaks we split",
  ])("does not match without a line number: %s", (text) => {
    expect(ids(comment(text))).not.toContain("line-number-crossref");
  });
});

describe("section-banner", () => {
  test.each([
    "# Helpers",
    "# Salesforce Sync",
    "// Public API",
    "# ----------",
    "// ====",
  ])("matches a banner: %s", (text) => {
    expect(ids(comment(text))).toContain("section-banner");
  });

  test.each([
    "# Read the config first",
    "# Returns the user.",
    "# this is a normal comment",
  ])("does not match a normal comment: %s", (text) => {
    expect(ids(comment(text))).not.toContain("section-banner");
  });

  test("does not apply to multi-line block comments", () => {
    expect(ids(comment("/* Helpers */", "block"))).not.toContain("section-banner");
    expect(ids(comment("Helpers", "docstring"))).not.toContain("section-banner");
  });
});

describe("detectTells", () => {
  test("a comment with no tells returns []", () => {
    expect(detectTells(comment("# load the user record"))).toEqual([]);
  });

  test("a comment matching two tells returns both, in TellId order", () => {
    expect(ids(comment("# ENG-2065 mirrors the guard at line 1208"))).toEqual([
      "roadmap-breadcrumb",
      "line-number-crossref",
    ]);
  });

  test("each tell carries a non-empty reason", () => {
    for (const tell of detectTells(comment("# ENG-2217 at line 5"))) {
      expect(tell.reason.length).toBeGreaterThan(0);
    }
  });

  test("multi-line comment still runs line-oriented checks", () => {
    expect(ids(comment("tracked in ENG-2065\nfix later", "block"))).toContain("roadmap-breadcrumb");
  });
});
