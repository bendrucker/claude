import { describe, expect, test } from "bun:test";
import * as fc from "fast-check";
import { rankComments, type SortKey, scoreComment } from "./rank";
import type { Comment } from "./types";

function comment(over: Partial<Comment> = {}): Comment {
  return {
    kind: "line",
    text: "// a comment",
    startLine: 1,
    endLine: 1,
    startColumn: 0,
    endColumn: 12,
    ...over,
  };
}

const commentArb: fc.Arbitrary<Comment> = fc
  .record({
    text: fc.string({ maxLength: 40 }),
    startLine: fc.integer({ min: 1, max: 100 }),
    span: fc.integer({ min: 0, max: 20 }),
  })
  .map(({ text, startLine, span }) => ({
    kind: "line",
    text,
    startLine,
    endLine: startLine + span,
    startColumn: 0,
    endColumn: text.length,
  }));

/** Independent stable sort: descending metric, original index breaks ties. */
function rankOracle<T extends Comment>(comments: T[], sort: SortKey): T[] {
  return comments
    .map((entry, index) => ({ comment: entry, index }))
    .toSorted((a, b) => {
      const diff = scoreComment(b.comment)[sort] - scoreComment(a.comment)[sort];
      return diff !== 0 ? diff : a.index - b.index;
    })
    .map((entry) => entry.comment);
}

describe("scoreComment", () => {
  test("counts lines and chars", () => {
    const c = comment({
      text: "First sentence. Second one! Third?",
      startLine: 10,
      endLine: 13,
    });
    const score = scoreComment(c);
    expect(score.lines).toBe(4);
    expect(score.chars).toBe(c.text.length);
  });

  test("score is dominated by char count with a line-span boost", () => {
    const long = scoreComment(comment({ text: "x".repeat(200), startLine: 1, endLine: 1 }));
    const tall = scoreComment(comment({ text: "x".repeat(10), startLine: 1, endLine: 5 }));
    expect(long.score).toBeGreaterThan(tall.score);
  });

  test("is computed from the comment alone, never surrounding code", () => {
    expect(scoreComment(comment({ text: "// same" }))).toEqual(
      scoreComment(comment({ text: "// same", startColumn: 40 })),
    );
  });
});

describe("rankComments", () => {
  const short = comment({ text: "// hi" });
  const medium = comment({ text: "// a medium length comment here" });
  const long = comment({ text: "x".repeat(120), startLine: 1, endLine: 3 });

  test("sorts descending by score by default", () => {
    expect(rankComments([short, long, medium])).toEqual([long, medium, short]);
  });

  test("sorts by lines when asked", () => {
    const tall = comment({ text: "// tall", startLine: 1, endLine: 9 });
    const wide = comment({ text: "x".repeat(500), startLine: 1, endLine: 1 });
    expect(rankComments([wide, tall], "lines")[0]).toBe(tall);
  });

  test("sorts by chars when asked", () => {
    const tall = comment({ text: "// short", startLine: 1, endLine: 9 });
    const wide = comment({ text: "x".repeat(80), startLine: 1, endLine: 1 });
    expect(rankComments([tall, wide], "chars")[0]).toBe(wide);
  });

  test("is stable for ties and does not mutate the input", () => {
    const a = comment({ text: "// tie", startLine: 1, endLine: 1 });
    const b = comment({ text: "// tie", startLine: 5, endLine: 5 });
    const input = [a, b];
    expect(rankComments(input)).toEqual([a, b]);
    expect(input).toEqual([a, b]);
  });

  test("is a stable non-ascending sort by the chosen metric that leaves the input untouched", () => {
    fc.assert(
      fc.property(
        fc.array(commentArb),
        fc.constantFrom<SortKey>("score", "lines", "chars"),
        (comments, sort) => {
          const before = comments.slice();
          const result = rankComments(comments, sort);
          expect(result).toEqual(rankOracle(comments, sort));
          expect(result).not.toBe(comments);
          expect(comments).toEqual(before);
        },
      ),
    );
  });
});
