import { expect, test } from "bun:test";
import fc from "fast-check";
import { type FetchedPr, type Item, type MinedPr, selectSample, toItem, weave } from "./mine";

function makeItem(overrides: Partial<Item>): Item {
  return {
    id: "",
    repo: "bendrucker/claude",
    pr_number: 1,
    url: "https://github.com/bendrucker/claude/pull/1",
    title: "a title",
    state: "MERGED",
    created_at: "2026-01-01T00:00:00Z",
    session_id: "s-1",
    size: "compact",
    body: "a body",
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
      expect(woven.toSorted((a, b) => a - b)).toEqual(lengths.toSorted((a, b) => a - b));
    }),
  );
});

test.each<{ name: string; counts: Record<string, number>; limit: number; expected: string[] }>([
  {
    name: "round-robins across repos before repeating one",
    counts: { "bendrucker/claude": 3, "bendrucker/dotfiles": 1 },
    limit: 3,
    expected: ["bendrucker/claude", "bendrucker/dotfiles", "bendrucker/claude"],
  },
  {
    name: "drains small repos and keeps filling from large ones",
    counts: { "bendrucker/claude": 4, "bendrucker/dotfiles": 1 },
    limit: 5,
    expected: [
      "bendrucker/claude",
      "bendrucker/dotfiles",
      "bendrucker/claude",
      "bendrucker/claude",
      "bendrucker/claude",
    ],
  },
  {
    name: "returns everything when under the limit",
    counts: { "bendrucker/claude": 2 },
    limit: 50,
    expected: ["bendrucker/claude", "bendrucker/claude"],
  },
])("selectSample $name", ({ counts, limit, expected }) => {
  const candidates = Object.entries(counts).flatMap(([repo, n]) =>
    Array.from({ length: n }, (_, i) =>
      makeItem({ repo, pr_number: i + 1, body: "x".repeat(10 * (i + 1)) }),
    ),
  );
  const selected = selectSample(candidates, limit);
  expect(selected.map((s) => s.repo)).toEqual(expected);
});

test("selectSample assigns sequential ids", () => {
  const candidates = [makeItem({ pr_number: 1 }), makeItem({ pr_number: 2 })];
  const ids = selectSample(candidates, 10).map((s) => s.id);
  expect(ids).toEqual(["pr-001", "pr-002"]);
});

test("toItem carries session metadata and sizes the body", () => {
  const mined: MinedPr = {
    repository: "bendrucker/claude",
    pr_number: 42,
    url: "https://github.com/bendrucker/claude/pull/42",
    opened_at: "2026-01-02 03:04:05",
    session_id: "abc-123",
  };
  const fetched: FetchedPr = {
    number: 42,
    title: "fix: a thing",
    body: "b".repeat(2000),
    url: "https://github.com/bendrucker/claude/pull/42",
    state: "MERGED",
    createdAt: "2026-01-02T03:04:05Z",
    author: { login: "bendrucker" },
  };
  expect(toItem(mined, fetched)).toMatchInlineSnapshot(
    { body: expect.any(String) },
    `
    {
      "body": Any<String>,
      "created_at": "2026-01-02T03:04:05Z",
      "id": "",
      "pr_number": 42,
      "repo": "bendrucker/claude",
      "session_id": "abc-123",
      "size": "full",
      "state": "MERGED",
      "title": "fix: a thing",
      "url": "https://github.com/bendrucker/claude/pull/42",
    }
  `,
  );
});
