import { describe, expect, test } from "bun:test";
import { commentFeatures } from "./features";
import type { Comment } from "./types";

function comment(text: string, startLine: number): Comment {
  const commentLines = text.split("\n");
  return {
    kind: "line",
    text,
    startLine,
    endLine: startLine + commentLines.length - 1,
    startColumn: 0,
    endColumn: commentLines[commentLines.length - 1]?.length ?? 0,
  };
}

describe("codeAlignment", () => {
  const lines = [
    "function createUser(record) {",
    "// creates the user from the record",
    "  return insertUser(record);",
    "}",
  ];

  test("a restatement of the adjacent identifiers scores high", () => {
    const features = commentFeatures(comment("// creates the user from the record", 2), lines);
    expect(features.codeAlignment).toBe(1);
  });

  test("a why comment naming facts outside the code scores low", () => {
    const features = commentFeatures(
      comment("// the API paginates at 100, so batch upstream", 2),
      lines,
    );
    expect(features.codeAlignment).toBeLessThan(0.5);
  });

  test("the comment's own words never align with themselves", () => {
    const only = ["// increment the retry counter"];
    const features = commentFeatures(comment("// increment the retry counter", 1), only);
    expect(features.codeAlignment).toBe(0);
  });

  test("a comment with no content words scores 0", () => {
    expect(commentFeatures(comment("// ??", 2), lines).codeAlignment).toBe(0);
  });
});

describe("marker features", () => {
  test.each([
    ["// retries because the API flakes", "whyMarker", true],
    ["// increments the counter", "whyMarker", false],
    ["// TODO(ENG-1234): drop once the backfill lands", "ticketId", true],
    ["// fixes #123", "ticketId", true],
    ["// the C-3 grade steel", "ticketId", false],
    ["// ------------------------------------", "dividerRule", true],
    ["# ==========\n# Helpers\n# ==========", "dividerRule", true],
    ["// a normal sentence", "dividerRule", false],
  ] as const)("%s → %s: %p", (text, key, expected) => {
    const features = commentFeatures(comment(text, 1), text.split("\n"));
    expect(features[key]).toBe(expected);
  });
});

describe("size features", () => {
  test("counts lines and chars of the raw text", () => {
    const text = "// one\n// two";
    const features = commentFeatures(comment(text, 1), text.split("\n"));
    expect(features.lines).toBe(2);
    expect(features.chars).toBe(text.length);
  });
});
