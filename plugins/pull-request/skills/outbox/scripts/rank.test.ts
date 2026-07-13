import { describe, expect, test } from "bun:test";
import { type ActionEntry, actionable, classify, rankQueue } from "./rank";

const NOW = new Date("2026-06-19T12:00:00Z");
const STALE_DAYS = 2;

function entry(overrides: Partial<ActionEntry>): ActionEntry {
  return {
    url: "https://github.com/o/r/pull/1",
    platform: "github",
    ci: "green",
    review: "none",
    isDraft: false,
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

const fresh = NOW.toISOString();
const stale = new Date("2026-06-15T12:00:00Z").toISOString();

describe("classify", () => {
  test.each([
    [
      "red CI beats every other signal",
      { ci: "red", review: "changes_requested", isDraft: true },
      "red-ci",
    ],
    [
      "changes requested when CI not red",
      { ci: "green", review: "changes_requested" },
      "changes-requested",
    ],
    ["green but untouched past staleDays", { ci: "green", updatedAt: stale }, "stale-green"],
    [
      "fresh green awaiting review",
      { ci: "green", review: "review_required", updatedAt: fresh },
      "waiting-on-review",
    ],
    [
      "pending CI awaiting review",
      { ci: "pending", review: "review_required" },
      "waiting-on-review",
    ],
    ["draft with nothing else pending", { isDraft: true, updatedAt: fresh }, "draft"],
    [
      "green, fresh, nothing pending",
      { ci: "green", review: "approved", updatedAt: fresh },
      "none",
    ],
    [
      "changes-requested outranks staleness",
      { ci: "green", review: "changes_requested", updatedAt: stale },
      "changes-requested",
    ],
    [
      "stale outranks awaiting-review",
      { ci: "green", review: "review_required", updatedAt: stale },
      "stale-green",
    ],
  ] as const)("%s", (_label, overrides, expected) => {
    expect(classify(entry(overrides), NOW, STALE_DAYS)).toBe(expected);
  });
});

describe("rankQueue", () => {
  test("orders by bucket priority, then oldest-updated within a bucket", () => {
    const ranked = rankQueue(
      [
        entry({ url: "draft", isDraft: true }),
        entry({ url: "red-new", ci: "red", updatedAt: fresh }),
        entry({ url: "red-old", ci: "red", updatedAt: stale }),
        entry({ url: "changes", review: "changes_requested" }),
      ],
      NOW,
      STALE_DAYS,
    );
    expect(ranked.map((entry) => entry.url)).toMatchInlineSnapshot(`
      [
        "red-old",
        "red-new",
        "changes",
        "draft",
      ]
    `);
  });
});

describe("actionable", () => {
  test("drops the no-action bucket and keeps everything else", () => {
    const ranked = rankQueue(
      [entry({ url: "act", ci: "red" }), entry({ url: "idle", ci: "green", review: "approved" })],
      NOW,
      STALE_DAYS,
    );
    expect(actionable(ranked).map((entry) => entry.url)).toEqual(["act"]);
  });
});
