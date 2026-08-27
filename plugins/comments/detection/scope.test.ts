import { describe, expect, test } from "bun:test";
import * as fc from "fast-check";
import { overlaps, scopeIntroduced } from "./scope";
import type { Comment, LineRange } from "./types";

function comment(startLine: number, endLine: number, text = "comment"): Comment {
  return {
    kind: "line",
    text,
    startLine,
    endLine,
    startColumn: 0,
    endColumn: text.length,
  };
}

function range(start: number, end: number): LineRange {
  return { start, end };
}

const commentArb: fc.Arbitrary<Comment> = fc
  .record({
    startLine: fc.integer({ min: 1, max: 30 }),
    span: fc.integer({ min: 0, max: 8 }),
    text: fc.string(),
  })
  .map(({ startLine, span, text }) => ({
    kind: "line",
    text,
    startLine,
    endLine: startLine + span,
    startColumn: 0,
    endColumn: text.length,
  }));

const rangeArb: fc.Arbitrary<LineRange> = fc
  .record({ start: fc.integer({ min: 1, max: 30 }), span: fc.integer({ min: 0, max: 8 }) })
  .map(({ start, span }) => ({ start, end: start + span }));

/** Independent oracle: enumerate the comment's lines and test membership in the range. */
function sharesLine(target: Comment, bounds: LineRange): boolean {
  for (let line = target.startLine; line <= target.endLine; line++) {
    if (line >= bounds.start && line <= bounds.end) return true;
  }
  return false;
}

describe("overlaps", () => {
  test("single-line comment exactly on an added line", () => {
    expect(overlaps(comment(5, 5), range(5, 5))).toBe(true);
  });

  test("comment entirely outside the range", () => {
    expect(overlaps(comment(1, 2), range(5, 8))).toBe(false);
  });

  test("multi-line block where only the last line falls in the range", () => {
    expect(overlaps(comment(3, 7), range(7, 9))).toBe(true);
  });

  test("comment range fully contains a small added range", () => {
    expect(overlaps(comment(2, 10), range(5, 6))).toBe(true);
  });

  test("comment ending exactly on range.start", () => {
    expect(overlaps(comment(2, 5), range(5, 9))).toBe(true);
  });

  test("comment starting exactly on range.end", () => {
    expect(overlaps(comment(9, 12), range(5, 9))).toBe(true);
  });

  test("comment one line before range.start", () => {
    expect(overlaps(comment(3, 4), range(5, 9))).toBe(false);
  });

  test("comment one line after range.end", () => {
    expect(overlaps(comment(10, 11), range(5, 9))).toBe(false);
  });

  test("agrees with per-line interval intersection", () => {
    fc.assert(
      fc.property(commentArb, rangeArb, (c, r) => {
        expect(overlaps(c, r)).toBe(sharesLine(c, r));
      }),
    );
  });
});

describe("scopeIntroduced", () => {
  test("empty added yields empty result", () => {
    expect(scopeIntroduced([comment(1, 1), comment(5, 5)], [])).toEqual([]);
  });

  test("empty comments yields empty result", () => {
    expect(scopeIntroduced([], [range(1, 5)])).toEqual([]);
  });

  test("includes a comment exactly on an added line, excludes one outside", () => {
    const onLine = comment(5, 5, "introduced");
    const outside = comment(20, 20, "preexisting");
    expect(scopeIntroduced([onLine, outside], [range(5, 5)])).toEqual([onLine]);
  });

  test("partial overlap of a multi-line block counts as introduced", () => {
    const block = comment(3, 7, "block");
    expect(scopeIntroduced([block], [range(7, 9)])).toEqual([block]);
  });

  test("matches against the second of multiple added ranges", () => {
    const c = comment(15, 15, "second range");
    expect(scopeIntroduced([c], [range(1, 3), range(14, 16)])).toEqual([c]);
  });

  test("preserves input order across a mixed input", () => {
    const first = comment(5, 5, "first");
    const skipped = comment(50, 50, "skipped");
    const second = comment(8, 8, "second");
    const result = scopeIntroduced([first, skipped, second], [range(4, 9)]);
    expect(result).toEqual([first, second]);
  });

  test("returns a new array without mutating inputs", () => {
    const comments = [comment(5, 5), comment(50, 50)];
    const added = [range(5, 5)];
    const result = scopeIntroduced(comments, added);
    expect(result).not.toBe(comments);
    expect(comments).toHaveLength(2);
    expect(added).toEqual([range(5, 5)]);
  });

  test("is the order-preserving filter of overlapping comments, leaving inputs untouched", () => {
    fc.assert(
      fc.property(fc.array(commentArb), fc.array(rangeArb), (comments, added) => {
        const commentsBefore = structuredClone(comments);
        const addedBefore = structuredClone(added);
        const result = scopeIntroduced(comments, added);
        const expected = comments.filter((c) => added.some((r) => sharesLine(c, r)));
        expect(result).toEqual(expected);
        expect(result).not.toBe(comments);
        expect(comments).toEqual(commentsBefore);
        expect(added).toEqual(addedBefore);
      }),
    );
  });
});
