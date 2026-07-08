import { expect, test } from "bun:test";
import fc from "fast-check";
import { type Item, type RewriteDraft, selectSample, toItem, weave } from "./mine";

function makeItem(overrides: Partial<Item>): Item {
  return {
    id: "",
    category: "commit-message",
    size: "compact",
    source: "synthetic",
    input: "an input",
    output: "an output",
    ...overrides,
  };
}

test("weave interleaves longest and shortest", () => {
  const lengths = [1, 2, 3, 4, 5];
  const woven = weave(lengths, (n) => n);
  expect(woven).toEqual([5, 1, 4, 2, 3]);
});

test("weave preserves the multiset", () => {
  fc.assert(
    fc.property(fc.array(fc.integer({ min: 0, max: 100 })), (lengths) => {
      const woven = weave(lengths, (n) => n);
      expect([...woven].sort((a, b) => a - b)).toEqual([...lengths].sort((a, b) => a - b));
    }),
  );
});

test.each<{ name: string; counts: Record<string, number>; limit: number; expected: string[] }>([
  {
    name: "round-robins across categories before repeating one",
    counts: { "commit-message": 3, "slack-update": 1 },
    limit: 3,
    expected: ["commit-message", "slack-update", "commit-message"],
  },
  {
    name: "drains small categories and keeps filling from large ones",
    counts: { "commit-message": 4, "slack-update": 1 },
    limit: 5,
    expected: [
      "commit-message",
      "slack-update",
      "commit-message",
      "commit-message",
      "commit-message",
    ],
  },
  {
    name: "returns everything when under the limit",
    counts: { "commit-message": 2 },
    limit: 50,
    expected: ["commit-message", "commit-message"],
  },
])("selectSample $name", ({ counts, limit, expected }) => {
  const candidates = Object.entries(counts).flatMap(([category, n]) =>
    Array.from({ length: n }, (_, i) =>
      makeItem({ category, output: "x".repeat(10 * (i + 1)) }),
    ),
  );
  const selected = selectSample(candidates, limit);
  expect(selected.map((s) => s.category)).toEqual(expected);
});

test("selectSample assigns sequential ids", () => {
  const candidates = [makeItem({ input: "a" }), makeItem({ input: "b" })];
  const ids = selectSample(candidates, 10).map((s) => s.id);
  expect(ids).toEqual(["rw-001", "rw-002"]);
});

test("toItem carries the category and sizes by output length", () => {
  const draft: RewriteDraft = {
    category: "doc-paragraph",
    input: "a".repeat(100),
    output: "b".repeat(800),
  };
  expect(toItem(draft)).toMatchInlineSnapshot(
    { input: expect.any(String), output: expect.any(String) },
    `
    {
      "category": "doc-paragraph",
      "id": "",
      "input": Any<String>,
      "output": Any<String>,
      "size": "full",
      "source": "synthetic",
    }
  `,
  );
});
