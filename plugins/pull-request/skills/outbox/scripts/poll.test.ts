import { describe, expect, test } from "bun:test";
import { fetchEntries, renderNeedsAction } from "./poll";
import { type ActionEntry, rankQueue } from "./rank";

const NOW = new Date("2026-06-19T12:00:00Z");

function ranked(entries: ActionEntry[]) {
  return rankQueue(entries, NOW, 2);
}

describe("renderNeedsAction", () => {
  test("renders the actionable slice as a ranked GFM table", () => {
    const md = renderNeedsAction(
      ranked([
        {
          url: "https://github.com/o/r/pull/2",
          platform: "github",
          ci: "green",
          review: "approved",
          isDraft: false,
          updatedAt: NOW.toISOString(),
        },
        {
          url: "https://github.com/o/r/pull/1",
          platform: "github",
          ci: "red",
          review: "none",
          isDraft: false,
          updatedAt: "2026-06-18T09:00:00Z",
        },
      ]),
    );
    expect(md).toMatchInlineSnapshot(`
      "# Needs action

      | Needs | CI | Review | Updated | PR |
      | --- | --- | --- | --- | --- |
      | CI failing | red | none | 2026-06-18 | https://github.com/o/r/pull/1 |
      "
    `);
  });

  test("reports the empty queue plainly", () => {
    expect(renderNeedsAction([])).toContain("Nothing needs you");
  });
});

describe("fetchEntries", () => {
  test("parses a queue command's JSON array", async () => {
    const result = await fetchEntries(
      `echo '[{"url":"u","platform":"github","ci":"red","review":"none","isDraft":false,"updatedAt":"2026-06-19T00:00:00Z"}]'`,
    );
    expect(result).toMatchInlineSnapshot(`
      {
        "entries": [
          {
            "ci": "red",
            "isDraft": false,
            "platform": "github",
            "review": "none",
            "updatedAt": "2026-06-19T00:00:00Z",
            "url": "u",
          },
        ],
        "ok": true,
      }
    `);
  });

  test("reports a non-zero exit as a failed source", async () => {
    const result = await fetchEntries("echo boom >&2; exit 3");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("boom");
  });
});
